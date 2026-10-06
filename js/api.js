// All communication with Supabase goes through this file.
// The database only exposes RPC functions (see supabase/setup.sql), so the
// app never reads or writes tables directly.

import config from '../config.js';

let client = null;

export function isConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseKey && window.supabase);
}

export function supa() {
  if (!client) {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'kolind-booking-auth',
      },
    });
  }
  return client;
}

export class ApiError extends Error {
  constructor(message, { code = '', status = 0, unreachable = false } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.unreachable = unreachable;
  }
}

const UNREACHABLE =
  'Kan ikke få forbindelse til bookingsystemet. Tjek din internetforbindelse. Har siden ikke været brugt i over en uge, kan databasen være sat på pause (se README).';

function looksOffline(message = '') {
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message);
}

function toApiError(error, status) {
  const code = error?.code || '';
  const message = error?.message || '';
  if (looksOffline(message) || status === 0 || status >= 500) {
    return new ApiError(UNREACHABLE, { code, status, unreachable: true });
  }
  if (code === 'P0001') return new ApiError(message, { code, status });
  if (code === '42501') {
    return new ApiError(/[æøå]|Du |Kun /.test(message) ? message : 'Du har ikke adgang til dette.', { code, status });
  }
  if (code === 'PGRST202') {
    return new ApiError('Databasen er ikke sat op endnu. Kør supabase/setup.sql i Supabase (se README).', { code, status });
  }
  if (code === 'PGRST301' || code === 'PGRST303' || status === 401) {
    return new ApiError('Din session er udløbet. Log ind igen.', { code, status });
  }
  if (code === '23P01') return new ApiError('Perioden overlapper et andet ophold.', { code, status });
  if (code?.startsWith('23')) return new ApiError('Nogle af oplysningerne er ikke gyldige.', { code, status });
  console.warn('Uventet fejl fra databasen', error);
  return new ApiError('Noget gik galt. Prøv igen om lidt.', { code, status });
}

async function rpc(fn, args = {}) {
  let res;
  try {
    res = await supa().rpc(fn, args);
  } catch (e) {
    throw new ApiError(UNREACHABLE, { unreachable: true });
  }
  if (res.error) throw toApiError(res.error, res.status);
  return res.data;
}

// ---------- Auth ----------

function authError(error) {
  const code = error?.code || '';
  const msg = error?.message || '';
  if (looksOffline(msg) || error?.status >= 500 && !/database error/i.test(msg)) {
    return new ApiError(UNREACHABLE, { unreachable: true });
  }
  if (code === 'invalid_credentials' || /invalid login/i.test(msg)) return new ApiError('Forkert email eller adgangskode.');
  if (code === 'email_not_confirmed') {
    return new ApiError('Kontoen er ikke bekræftet. Slå "Confirm email" fra i Supabase (se README), og prøv igen.');
  }
  if (code === 'user_already_exists' || /already registered/i.test(msg)) {
    return new ApiError('Der findes allerede en konto med den email. Log ind i stedet.');
  }
  if (code === 'weak_password') return new ApiError('Adgangskoden er for svag. Brug mindst 8 tegn.');
  if (/rate limit|too many/i.test(msg) || code?.includes('rate_limit')) return new ApiError('For mange forsøg. Vent et øjeblik, og prøv igen.');
  if (code === 'signup_disabled') return new ApiError('Oprettelse af konti er slået fra i Supabase. Se README under "Authentication".');
  if (/database error saving new user/i.test(msg) || code === 'unexpected_failure') {
    return new ApiError('Invitationen kunne ikke bruges. Den er måske allerede brugt eller udløbet.');
  }
  return new ApiError(msg || 'Noget gik galt. Prøv igen.');
}

export const auth = {
  async session() {
    const { data } = await supa().auth.getSession();
    return data.session;
  },
  onChange(fn) {
    return supa().auth.onAuthStateChange((event, session) => fn(event, session));
  },
  async signIn(email, password) {
    const { data, error } = await supa().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw authError(error);
    return data.session;
  },
  async signUpWithInvite(email, password, token) {
    const { data, error } = await supa().auth.signUp({
      email: email.trim(),
      password,
      options: { data: { invite_token: token } },
    });
    if (error) throw authError(error);
    if (!data.session) {
      throw new ApiError('Kontoen er oprettet, men Supabase kræver email-bekræftelse. Slå "Confirm email" fra (se README), og log ind.');
    }
    return data.session;
  },
  async updatePassword(password) {
    const { error } = await supa().auth.updateUser({ password });
    if (error) throw authError(error);
  },
  async signOut() {
    await supa().auth.signOut().catch(() => {});
  },
};

// ---------- Family members ----------

export const api = {
  me: () => rpc('get_me'),
  updateMyProfile: (fullName, phone) => rpc('update_my_profile', { p_full_name: fullName, p_phone: phone || null }),
  properties: () => rpc('list_properties'),
  propertyAccess: (propertyId) => rpc('get_property_access', { p_property_id: propertyId }),
  calendar: (from, to) => rpc('get_calendar', { p_from: from, p_to: to }),
  requestBooking: ({ propertyId, start, end, guests, comment }) =>
    rpc('request_booking', {
      p_property_id: propertyId,
      p_start_date: start,
      p_end_date: end,
      p_guests: guests,
      p_comment: comment || null,
    }),
  myBookings: () => rpc('my_bookings'),
  cancelBooking: (id, reason) => rpc('cancel_booking', { p_id: id, p_reason: reason || null }),
  createGuestLink: ({ label, propertyId, days }) =>
    rpc('create_guest_link', { p_label: label, p_property_id: propertyId || null, p_valid_days: days || 60 }),
  myGuestLinks: () => rpc('my_guest_links'),
  adminContacts: () => rpc('admin_contacts'),
  revokeGuestLink: (id) => rpc('revoke_guest_link', { p_id: id }),
};

// ---------- Administration ----------

export const admin = {
  bookings: (scope) => rpc('admin_bookings', { p_scope: scope }),
  detail: (id) => rpc('admin_booking_detail', { p_id: id }),
  decide: (id, approve, message) => rpc('admin_decide_booking', { p_id: id, p_approve: approve, p_message: message || null }),
  save: (b) =>
    rpc('admin_save_booking', {
      p_id: b.id || null,
      p_property_id: b.propertyId,
      p_kind: b.kind,
      p_start_date: b.start,
      p_end_date: b.end,
      p_guests: b.guests ?? null,
      p_user_id: b.userId || null,
      p_person_name: b.personName || null,
      p_guest_email: b.guestEmail || null,
      p_guest_phone: b.guestPhone || null,
      p_title: b.title || null,
      p_comment: b.comment || null,
    }),
  remove: (id) => rpc('admin_delete_booking', { p_id: id }),
  setNote: (id, note) => rpc('admin_set_booking_note', { p_id: id, p_note: note || '' }),
  people: () => rpc('admin_people'),
  invite: (email, fullName, role) => rpc('admin_create_invitation', { p_email: email, p_full_name: fullName, p_role: role }),
  deleteInvitation: (id) => rpc('admin_delete_invitation', { p_id: id }),
  updateMember: (m) =>
    rpc('admin_update_member', {
      p_user_id: m.id,
      p_full_name: m.fullName,
      p_phone: m.phone || null,
      p_role: m.role,
      p_active: m.active,
    }),
  passwordReset: (userId) => rpc('admin_create_password_reset', { p_user_id: userId }),
  updateProperty: (id, data) => rpc('admin_update_property', { p_id: id, p_data: data }),
  updateAccess: (id, a) =>
    rpc('admin_update_property_access', {
      p_property_id: id,
      p_wifi_name: a.wifi_name || null,
      p_wifi_password: a.wifi_password || null,
      p_access_info: a.access_info || null,
    }),
  exportAll: () => rpc('admin_export'),
};

// ---------- Links (work without login) ----------

export const links = {
  invitation: (token) => rpc('invitation_info', { p_token: token }),
  resetInfo: (token) => rpc('password_reset_info', { p_token: token }),
  redeemReset: (token, password) => rpc('redeem_password_reset', { p_token: token, p_password: password }),
  guestLink: (token) => rpc('guest_link_info', { p_token: token }),
  guestCalendar: (token, from, to) => rpc('guest_calendar', { p_token: token, p_from: from, p_to: to }),
  guestRequest: (token, r) =>
    rpc('guest_request_booking', {
      p_token: token,
      p_property_id: r.propertyId,
      p_start_date: r.start,
      p_end_date: r.end,
      p_guests: r.guests,
      p_name: r.name,
      p_email: r.email,
      p_phone: r.phone || null,
      p_comment: r.comment || null,
    }),
  guestStatus: (statusToken) => rpc('guest_booking_status', { p_status_token: statusToken }),
  guestCancel: (statusToken) => rpc('guest_cancel_booking', { p_status_token: statusToken }),
};
