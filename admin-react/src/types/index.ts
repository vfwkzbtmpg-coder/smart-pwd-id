/**
 * TypeScript types used across the React admin console.
 *
 * NOTE: We intentionally do NOT include any secrets / service_role values here.
 * These only describe row shapes we read from Supabase.
 */

import type { ApplicationStatusUi } from '../../config/dbSchemaConfig';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      pwd_applications: {
        Row: {
          id: string;
          user_id: string;
          status: string | null;
          submitted_at: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          review_notes: string | null;
          disability_type: string | null;
          disability_id_no: string | null;
          id_front_url: string | null;
          id_back_url: string | null;
          photo_url: string | null;
          medical_cert_url: string | null;
          barangay_cert_url: string | null;
          birthdate: string | null;
          sex: string | null;
          blood_type: string | null;
          emergency_name: string | null;
          emergency_contact: string | null;
          address: string | null;
          signature_url: string | null;
          bg_front: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: string | null;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          review_notes?: string | null;
          disability_type?: string | null;
          disability_id_no?: string | null;
          id_front_url?: string | null;
          id_back_url?: string | null;
          photo_url?: string | null;
          medical_cert_url?: string | null;
          barangay_cert_url?: string | null;
          birthdate?: string | null;
          sex?: string | null;
          blood_type?: string | null;
          emergency_name?: string | null;
          emergency_contact?: string | null;
          address?: string | null;
          signature_url?: string | null;
          bg_front?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          status?: string | null;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          review_notes?: string | null;
          disability_type?: string | null;
          disability_id_no?: string | null;
          id_front_url?: string | null;
          id_back_url?: string | null;
          photo_url?: string | null;
          medical_cert_url?: string | null;
          barangay_cert_url?: string | null;
          birthdate?: string | null;
          sex?: string | null;
          blood_type?: string | null;
          emergency_name?: string | null;
          emergency_contact?: string | null;
          address?: string | null;
          signature_url?: string | null;
          bg_front?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
      };
      profiles: {
        Row: {
          id: string;
          first_name: string | null;
          last_name: string | null;
          middle_name: string | null;
          full_name: string | null;
          mobile: string | null;
          contact_number: string | null;
          pwd_id_number: string | null;
          id_number: string | null;
          expiration_date: string | null;
          valid_until: string | null;
          birthdate: string | null;
          account_type: string | null;
          role: string | null;
          application_status: string | null;
          address_house_no: string | null;
          address_street: string | null;
          address_barangay: string | null;
          address_city: string | null;
          address_province: string | null;
          address_postal_code: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
      };
      verification_transactions: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
    };
    Views: Record<string, unknown>;
    Functions: Record<string, unknown>;
    Enums: Record<string, unknown>;
  };
}

/* ---------------------------- Composite types the UI operates on ----------------------------- */

export interface ApplicantProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  full_name: string | null;
  email: string | null; // derived from auth.users via service role or fallback null
  mobile: string | null;
  contact_number: string | null;
  pwd_id_number: string | null;
  id_number: string | null;
  expiration_date: string | null;
  valid_until: string | null;
  address_house_no: string | null;
  address_street: string | null;
  address_barangay: string | null;
  address_city: string | null;
  address_province: string | null;
  address_postal_code: string | null;
  birthdate: string | null;
  application_status: string | null;
}

export interface ApplicationRow {
  id: string;
  user_id: string;
  statusRaw: string | null;
  status: ApplicationStatusUi;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  admin_notes: string | null;
  disability_type: string | null;
  disability_id_no: string | null;
  created_at: string | null;
  updated_at: string | null;
  documents: {
    id_front_url: string | null;
    id_back_url: string | null;
    photo_url: string | null;
    medical_cert_url: string | null;
    barangay_cert_url: string | null;
  };
  applicant: ApplicantProfile;
  /** Everything the Digital ID Card prints, already resolved for rendering. */
  card: DigitalIdCardData;
  /** Derived for UI convenience */
  applicantName: string;
  applicantEmail: string | null;
  applicantPhone: string | null;
  applicationIdShort: string;
  applicationDate: string | null;
}

export interface DigitalIdCardData {
  /** profiles.id_number once issued, otherwise blank ("PENDING" is shown). */
  idNumber: string;
  name: string;
  disabilityType: string;
  birthdate: string;
  sex: string;
  photoUrl: string;
  signatureUrl: string;
  emergencyName: string;
  emergencyContact: string;
  address: string;
  bloodType: string;
  /** Date the application was decided (printed as "Date issued"). */
  dateIssued: string | null;
  validUntil: string | null;
  /** LGU slug of the selected front background, e.g. "las-pinas". */
  bgFront: string;
}

export interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  accountType: string | null;
  isAdmin: boolean;
  createdAt: string | null;
}

export type { ApplicationStatusUi };
