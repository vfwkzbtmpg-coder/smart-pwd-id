SMART PWD ID - USB + Supabase version (no WiFi needed)

The people being verified are the real PWD records in Supabase. A tap is
matched by the tag UID stored on profiles.nfc_uid. Only holders whose
application_status is 'Approved' and whose valid_until has not passed are
authorised. The tap history stays in a local file, pwd_id.db.

1. Apply supabase/migrations/010_nfc_id_unique.sql once in the Supabase SQL
   editor. It adds profiles.nfc_uid, copies any existing nfc_id values, and
   creates a unique index so one tag cannot be linked to two people.
2. Install Python 3 (python.org). Tick "Add Python to PATH".
3. Open a terminal in this folder and run:
      pip install pyserial supabase
4. Upload your ORIGINAL SMART_PWD_ID.ino to the ESP32 (no changes needed).
5. Close the Arduino Serial Monitor, keep the ESP32 plugged in with USB.
6. Run:  python server.py     (or: python server.py COM5)
7. The website opens at http://localhost:8000

Linking a card
  - Open the Registry tab, pick an approved PWD ID holder, press
    "Save, then tap card", then tap the new card on the reader.
  - "Unlink" removes the tag from that holder. The person record stays.
  - A tag can only be linked to one person at a time.

Pointing at another Supabase project
  - Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before starting the server.
    The service_role key is required because it reads every PWD record; never
    put it on a web page.

Reader not connecting?
  - Run:  python server.py --ports     (lists the USB ports the computer can see)
  - Close the Arduino Serial Monitor. Use a USB data cable (not charge-only).
  - Install the CP210x or CH340 driver if no port appears.
  - Wrong package? Run: pip uninstall serial   then   pip install pyserial

Registry not loading?
  - "The supabase package is missing" -> run: pip install supabase
  - "Could not read the registry" -> the Supabase project may be paused.
    Free-tier projects pause after 7 days of inactivity; restore it in the
    Supabase Dashboard.
  - Empty list of holders -> no profile has application_status = 'Approved'.
  - "already linked to another person" -> the tag is already assigned to a
    different holder. Migration 010 enforces this with a unique index.
