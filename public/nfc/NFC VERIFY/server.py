"""
SMART PWD ID - bridge between the ESP32 reader, Supabase and the website.

No WiFi needed. The ESP32 stays plugged into this computer with USB.
Your original Arduino sketch works as is (it sends SCAN:<UID> and waits for
RESULT:AUTHORIZED or RESULT:NOT_AUTHORIZED).

A tap is checked against the real PWD records in Supabase: the hardware tag
UID is matched to profiles.nfc_uid, and the holder is authorised only when
their application_status is 'Approved' and valid_until has not passed.

Setup (once):   pip install pyserial supabase
Run:            python server.py              (or: python server.py COM5)
Then open:      http://localhost:8000
"""
import json, os, re, socket, sys, threading, time, sqlite3, webbrowser
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

# This network advertises a NAT64 prefix (64:ff9b::/96) whose gateway does not
# answer. Python walks getaddrinfo results in order, so each new connection
# stalled ~21s per dead IPv6 address (42s total) before reaching IPv4, which
# made every registry lookup time out. Browsers and Node fall back on their own;
# Python does not. Supabase answers on IPv4, so ask for IPv4 only.
_getaddrinfo = socket.getaddrinfo


def _ipv4_first(host, port, family=0, type=0, proto=0, flags=0):
    try:
        return _getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
    except OSError:
        return _getaddrinfo(host, port, family, type, proto, flags)


socket.getaddrinfo = _ipv4_first

# ================= SETTINGS =================
# The people being verified live in Supabase. Override with environment
# variables when pointing at another project.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://fvyinioymlegzfhrahbt.supabase.co")
# Service-role credential: environment only, never committed to the repository.
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_KEY:
    raise SystemExit(
        "SUPABASE_SERVICE_ROLE_KEY is not set. Export it before starting the kiosk:\n"
        '  Windows:      $env:SUPABASE_SERVICE_ROLE_KEY = "<key>"\n'
        "  Raspberry Pi: export SUPABASE_SERVICE_ROLE_KEY=<key>"
    )
ID_TYPE = "PWD ID"            # every record in the registry is a PWD ID
SQLITE_FILE = "pwd_id.db"     # local tap history only; the registry is in Supabase
PORT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else ""   # empty = find the ESP32 automatically
BAUD = 115200
WEB_HOST, WEB_PORT = "127.0.0.1", 8000
# ============================================

HERE = os.path.dirname(os.path.abspath(__file__))
lock = threading.Lock()
ser_ref = [None]
state = {
    "serial": {"connected": False, "port": "", "message": "Starting..."},
    "enroll": None,
    "last": None,
    "seq": 0,
}


# ---------- Supabase (the registry) ----------
_client = [None]


def client():
    if _client[0] is None:
        try:
            from supabase import create_client
        except Exception:
            raise RuntimeError("The supabase package is missing. Run:  pip install supabase")
        _client[0] = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client[0]


PROFILE_COLS = "id,first_name,last_name,mobile,id_number,application_status,valid_until,nfc_uid,qr_enabled,nfc_enabled"
PROFILE_COLS_NO_SETTINGS = "id,first_name,last_name,mobile,id_number,application_status,valid_until,nfc_uid"
PROFILE_COLS_LEGACY = "id,first_name,last_name,mobile,id_number,application_status,valid_until,nfc_id,qr_enabled,nfc_enabled"
PROFILE_COLS_LEGACY_NO_SETTINGS = "id,first_name,last_name,mobile,id_number,application_status,valid_until,nfc_id"


def select_profiles(equal=None, not_null=None, order=None, limit=None):
    """Read current or legacy NFC columns, defaulting optional flags to enabled."""
    def execute(columns, uid_column):
        query = client().table("profiles").select(columns)
        for column, value in (equal or {}).items():
            if column == "nfc_uid" and uid_column == "nfc_id":
                column = "nfc_id"
            query = query.eq(column, value)
        if not_null:
            null_column = "nfc_id" if not_null == "nfc_uid" and uid_column == "nfc_id" else not_null
            query = query.not_.is_(null_column, "null")
        if order:
            query = query.order(order)
        if limit is not None:
            query = query.limit(limit)
        return query.execute().data or []

    options = (
        (PROFILE_COLS, "nfc_uid"),
        (PROFILE_COLS_NO_SETTINGS, "nfc_uid"),
        (PROFILE_COLS_LEGACY, "nfc_id"),
        (PROFILE_COLS_LEGACY_NO_SETTINGS, "nfc_id"),
    )
    last_error = None
    for columns, uid_column in options:
        try:
            rows = execute(columns, uid_column)
            for row in rows:
                if uid_column == "nfc_id":
                    row["nfc_uid"] = row.get("nfc_id")
                row["_nfc_column"] = uid_column
                row.setdefault("qr_enabled", True)
                row.setdefault("nfc_enabled", True)
            return rows
        except Exception as error:
            message = str(error).lower()
            if any(column in message for column in ("nfc_uid", "qr_enabled", "nfc_enabled")):
                last_error = error
                continue
            raise
    raise last_error


def person_name(p):
    return " ".join(x for x in [p.get("first_name"), p.get("last_name")] if x).strip() or "Unnamed"


def find_by_uid(uid):
    rows = select_profiles(equal={"nfc_uid": uid}, limit=1)
    return rows[0] if rows else None


def find_by_qr(value):
    """Resolve the PWD ID number printed in the holder's QR, or a legacy NFC UID."""
    raw = str(value or "").strip()
    candidates = [raw]
    normalized = norm(raw)
    if normalized and normalized != raw:
        candidates.append(normalized)
    for candidate in candidates:
        rows = select_profiles(equal={"id_number": candidate}, limit=1)
        if rows:
            return rows[0]

    if re.fullmatch(r"[0-9a-fA-F-]{36}", raw):
        rows = select_profiles(equal={"id": raw}, limit=1)
        if rows:
            return rows[0]
    return find_by_uid(normalized)


def card_data_for(person):
    """Load the latest application fields used by the issued Digital ID card."""
    rows = client().table("pwd_applications").select(
        "birthdate,disability_type,sex,blood_type,emergency_name,emergency_contact,"
        "address,signature_url,bg_front,photo_url,submitted_at,reviewed_at"
    ).eq("user_id", person["id"]).order("submitted_at", desc=True).limit(1).execute().data or []
    app = rows[0] if rows else {}
    return {
        "uid": person.get("nfc_uid") or "",
        "name": person_name(person),
        "idNumber": person.get("id_number") or "",
        "status": status_of(person),
        "expires": exp_str(person.get("valid_until")),
        "birthdate": app.get("birthdate") or "",
        "disabilityType": app.get("disability_type") or "",
        "sex": app.get("sex") or "",
        "bloodType": app.get("blood_type") or "",
        "emergencyName": app.get("emergency_name") or "",
        "emergencyContact": app.get("emergency_contact") or person.get("mobile") or "",
        "address": app.get("address") or "",
        "signatureUrl": app.get("signature_url") or "",
        "bgFront": app.get("bg_front") or "",
        "photoUrl": app.get("photo_url") or "",
        "submittedAt": app.get("submitted_at") or "",
        "reviewedAt": app.get("reviewed_at") or "",
    }


def status_of(person):
    """valid / expired / unknown. Anything not currently approved is not a valid ID."""
    if not person:
        return "unknown"
    if str(person.get("application_status") or "").strip() != "Approved":
        return "unknown"
    exp = exp_str(person.get("valid_until"))
    return "expired" if exp and exp < date.today().isoformat() else "valid"


def link_tag(person_id, uid):
    """Bind a tapped tag to a person. Returns an error message, or None on success."""
    try:
        rows = select_profiles(equal={"id": person_id}, limit=1)
        if not rows:
            return "That PWD holder is no longer in the registry."
        column = rows[0].get("_nfc_column", "nfc_uid")
        client().table("profiles").update({column: uid}).eq("id", person_id).execute()
        return None
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        if ("nfc_uid" in msg or "nfc_id" in msg) and ("duplicate" in low or "unique" in low or "23505" in msg):
            return "That card is already linked to another person."
        return "Could not link the card: " + msg


# ---------- local tap history ----------
def log_db():
    con = sqlite3.connect(os.path.join(HERE, SQLITE_FILE))
    con.row_factory = sqlite3.Row
    return con


def run(sql, params=(), one=False, many=False):
    con = log_db()
    try:
        cur = con.cursor()
        cur.execute(sql, params)
        if one or many:
            rows = [dict(r) for r in cur.fetchall()]
            return (rows[0] if rows else None) if one else rows
        con.commit()
        return cur.lastrowid
    finally:
        con.close()


def init_db():
    run("""CREATE TABLE IF NOT EXISTS scan_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        name TEXT,
        result TEXT NOT NULL,
        scanned_at TEXT DEFAULT CURRENT_TIMESTAMP)""")


def norm(s):
    return "".join(ch for ch in str(s).upper() if ch.isalnum())


def exp_str(v):
    s = str(v) if v else ""
    return s[:10]


# ---------- scan handling ----------
def handle_scan(raw_uid, reply):
    uid = norm(raw_uid)
    if not uid:
        return
    with lock:
        enroll = state["enroll"]
        state["enroll"] = None
    name, typ, exp, err = "", "", "", None
    status = "unknown"
    try:
        if enroll:
            err = link_tag(enroll["id"], uid)
            if err:
                name = enroll.get("name", "")
            else:
                status = "enrolled"
                reply("RESULT:AUTHORIZED")
                name = enroll.get("name", "")
                typ, exp = ID_TYPE, enroll.get("expires") or ""
        else:
            person = find_by_uid(uid)
            status = status_of(person)
            if status == "valid" and person.get("nfc_enabled") is False:
                status = "disabled"
            reply("RESULT:AUTHORIZED" if status == "valid" else "RESULT:NOT_AUTHORIZED")
            if person:
                name = person_name(person)
                typ = ID_TYPE
                exp = exp_str(person.get("valid_until"))
        run("INSERT INTO scan_log (uid, name, result) VALUES (?,?,?)", (uid, name, status))
    except Exception as e:
        print("Verification error:", e)
        reply("RESULT:NOT_AUTHORIZED")
        return
    with lock:
        state["seq"] += 1
        state["last"] = {"seq": state["seq"], "uid": uid, "status": status,
                         "name": name, "type": typ, "expires": exp, "error": err or "",
                         "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    print("SCAN", uid, "->", status, name)


def verify_qr(raw_uid):
    raw = str(raw_uid or "").strip()
    uid = norm(raw)
    if not uid:
        raise ValueError("The QR code does not contain a card number.")
    person = find_by_qr(raw)
    status = status_of(person)
    if status == "valid" and person.get("qr_enabled") is False:
        status = "disabled"
    name = person_name(person) if person else ""
    run("INSERT INTO scan_log (uid, name, result) VALUES (?,?,?)", (uid, name, status))
    return {"uid": raw, "status": status, "name": name,
            "type": ID_TYPE if person else "",
            "idNumber": (person.get("id_number") or "") if person else "",
            "expires": exp_str(person.get("valid_until")) if person else "",
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}


# ---------- serial thread ----------
BOARD_UARTS = ("/dev/ttyS", "/dev/ttyAMA", "/dev/ttyPS", "/dev/serial0", "/dev/serial1")


def is_board_uart(device):
    # On Raspberry Pi / Ubuntu these are the onboard SoC UARTs, never the ESP32.
    return device.startswith(BOARD_UARTS)


def find_port():
    from serial.tools import list_ports
    ports = list(list_ports.comports())
    usable = [p for p in ports
              if "BLUETOOTH" not in ((p.description or "") + (p.hwid or "")).upper()
              and not is_board_uart(p.device)]
    good = [p for p in usable if p.vid in (0x10C4, 0x1A86, 0x303A, 0x0403)
            or any(k in (p.description or "").upper() for k in ("CP210", "CH340", "USB SERIAL", "UART", "ESP32", "USB"))]
    pick = good or usable
    return (pick[0].device if pick else None), ports


def show_ports():
    try:
        from serial.tools import list_ports
    except Exception as e:
        print("pyserial problem:", e)
        return
    ports = list(list_ports.comports())
    print("Serial ports found:", len(ports))
    for p in ports:
        print("  ", p.device, "-", p.description)


def set_serial(connected, port, message):
    if state["serial"].get("message") != message:
        print(message)
    state["serial"] = {"connected": connected, "port": port, "message": message}


def serial_loop():
    try:
        import serial
        import serial.tools.list_ports
        serial.Serial
    except Exception:
        set_serial(False, "", "pyserial is missing or the wrong package is installed. "
                              "Run: pip uninstall serial   then   pip install pyserial")
        return
    show_ports()
    while True:
        try:
            port, seen = (PORT, []) if PORT else find_port()
            if not port:
                names = ", ".join(p.device for p in seen) or "none"
                set_serial(False, "", "No ESP32 found on USB. Use a data cable, install the CP210x or CH340 driver, "
                                      "then replug it. Ports seen: " + names)
                time.sleep(2)
                continue
            with serial.Serial(port, BAUD, timeout=0.2) as ser:
                ser_ref[0] = ser
                set_serial(True, port, "Connected on " + port)
                buf = b""
                while True:
                    buf += ser.read(256)
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        line = line.decode("utf-8", "ignore").strip()
                        if line:
                            print("ESP32:", line)
                        if line.startswith("SCAN:"):
                            handle_scan(line[5:], lambda m: ser.write((m + "\n").encode()))
                        elif line.startswith("ERROR:"):
                            state["serial"]["message"] = "Reader error: " + line[6:]
        except Exception as e:
            ser_ref[0] = None
            msg = str(e)
            low = msg.lower()
            hint = ""
            if "denied" in low:
                hint = (" On Linux this port belongs to the dialout group. Fix it once with: "
                        "sudo usermod -aG dialout $USER   then log out and back in "
                        "(temporary: sudo chmod 666 /dev/ttyUSB0).")
            elif "busy" in low or "could not open" in low:
                hint = (" Close the Arduino Serial Monitor and any other program using the port"
                        " (on Ubuntu also: sudo systemctl stop brltty-udev).")
            set_serial(False, "", "Cannot use the port (%s).%s Trying again..." % (msg, hint))
            time.sleep(2)


# ---------- web server ----------
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            b = open(os.path.join(HERE, "index.html"), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
        elif re.fullmatch(r"/backgrounds/[a-z0-9-]+\.png", p):
            # Reuse the same LGU artwork as applications.html without exposing
            # arbitrary files from the project directory.
            image_name = p.rsplit("/", 1)[-1]
            image_path = os.path.join(HERE, "..", "..", "backgrounds", image_name)
            try:
                with open(image_path, "rb") as image:
                    b = image.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Cache-Control", "public, max-age=3600")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)
            except OSError:
                self.send_json({"error": "Card background not found."}, 404)
        elif p == "/api/card":
            uid = (parse_qs(self.path.partition("?")[2]).get("uid") or [""])[0]
            if not norm(uid):
                self.send_json({"error": "Card UID is required."}, 400)
                return
            try:
                person = find_by_qr(uid)
                if not person:
                    self.send_json({"error": "No PWD ID holder is linked to this card."}, 404)
                    return
                self.send_json(card_data_for(person))
            except Exception as e:
                print("Card detail error:", e)
                self.send_json({"error": "Could not load this card's application details."}, 500)
        elif p == "/api/state":
            with lock:
                self.send_json({"serial": state["serial"], "last": state["last"],
                                "enrolling": bool(state["enroll"]),
                                "enrollName": state["enroll"]["name"] if state["enroll"] else ""})
        elif p == "/api/cards":
            try:
                rows = select_profiles(not_null="nfc_uid", order="last_name")
                self.send_json([{
                    "id": r["id"], "uid": r["nfc_uid"], "name": person_name(r),
                    "id_type": ID_TYPE, "idNumber": r.get("id_number") or "",
                    "expires": exp_str(r.get("valid_until")), "status": status_of(r),
                } for r in rows])
            except Exception as e:
                print("Registry error:", e)
                self.send_json({"error": "Could not read the registry: " + str(e)}, 500)
        elif p == "/api/people":
            try:
                rows = select_profiles(equal={"application_status": "Approved"}, order="last_name")
                self.send_json([{
                    "id": r["id"], "name": person_name(r),
                    "idNumber": r.get("id_number") or "",
                    "linked": bool(r.get("nfc_uid")),
                } for r in rows])
            except Exception as e:
                print("Registry error:", e)
                self.send_json({"error": "Could not read the registry: " + str(e)}, 500)
        elif p == "/api/log":
            rows = run("SELECT uid, name, result, scanned_at FROM scan_log ORDER BY id DESC LIMIT 100", many=True)
            for r in rows:
                r["scanned_at"] = str(r["scanned_at"])
            self.send_json(rows)
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        p, d = self.path.split("?")[0], self.body()
        if p == "/api/verify":
            try:
                self.send_json(verify_qr(d.get("uid", "")))
            except ValueError as e:
                self.send_json({"error": str(e)}, 400)
            except Exception as e:
                print("QR verification error:", e)
                self.send_json({"error": "Could not verify this QR code."}, 500)
        elif p == "/api/enroll":
            try:
                person_id = str(d.get("personId", "")).strip()
                if not person_id:
                    return self.send_json({"error": "Choose a PWD ID holder first."}, 400)
                rows = select_profiles(equal={"id": person_id}, limit=1)
                if not rows:
                    return self.send_json({"error": "That person is no longer in the registry."}, 404)
                person = rows[0]
                with lock:
                    state["enroll"] = {"id": person["id"], "name": person_name(person),
                                       "expires": exp_str(person.get("valid_until"))}
                self.send_json({"ok": True, "name": person_name(person)})
            except Exception as e:
                print("Enroll error:", e)
                self.send_json({"error": "Could not start enrollment: " + str(e)}, 500)
        elif p == "/api/enroll/cancel":
            with lock:
                state["enroll"] = None
            self.send_json({"ok": True})
        elif p == "/api/log/clear":
            run("DELETE FROM scan_log")
            self.send_json({"ok": True})
        else:
            self.send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        # Unlinks a tag from its holder. The person stays in the registry.
        parts = self.path.split("?")[0].strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "cards"] and parts[2]:
            try:
                rows = select_profiles(equal={"id": parts[2]}, limit=1)
                if not rows:
                    return self.send_json({"error": "PWD holder not found."}, 404)
                column = rows[0].get("_nfc_column", "nfc_uid")
                client().table("profiles").update({column: None}).eq("id", parts[2]).execute()
                self.send_json({"ok": True})
            except Exception as e:
                print("Unlink error:", e)
                self.send_json({"error": "Could not unlink the card: " + str(e)}, 500)
        else:
            self.send_json({"error": "not found"}, 404)


if __name__ == "__main__":
    if "--ports" in sys.argv:
        show_ports()
        sys.exit()
    init_db()
    threading.Thread(target=serial_loop, daemon=True).start()
    httpd = None
    for p in range(WEB_PORT, WEB_PORT + 11):
        try:
            httpd = ThreadingHTTPServer((WEB_HOST, p), H)
            break
        except OSError:
            print("Port", p, "is busy, trying the next one...")
    if httpd is None:
        print("Could not start the web server. Close other programs and try again.")
        sys.exit(1)
    url = "http://localhost:%d" % httpd.server_address[1]
    print("Registry:", SUPABASE_URL)
    print("")
    print(">>> Open this address in your browser:", url)
    print(">>> Keep this window open. Press Ctrl+C to stop.")
    try:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")
