// Session helpers shared by the login flows and the app shell.

import { state, loadMe, loadProperties } from './state.js';
import { navigate } from './router.js';
import config from '../config.js';
import { adminContacts, hostNames } from './mail.js';

export async function loadSessionData() {
  if (!state.session) {
    state.me = null;
    return;
  }
  await loadMe();
  if (state.me?.active) {
    await loadProperties();
    const admins = await adminContacts();
    if (admins.length) config.adminNames = hostNames(admins);
  }
}

// Called by login/invite flows after a successful sign-in.
export async function signedIn(session, next = '/') {
  state.session = session;
  await loadSessionData();
  navigate(next, { replace: true });
}
