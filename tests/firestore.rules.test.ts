/**
 * Security tests for firestore.rules, run against the local Firestore emulator:
 *   npm run test:rules
 * The audit log must accept content-free events and reject anything that could carry text.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-redline',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const good = (uid: string) => ({
  uid,
  ts: serverTimestamp(),
  site: 'gemini.google.com',
  action: 'redacted',
  counts: { PERSON: 2, ORG: 1, FINANCIAL: 1 },
  total: 4,
  nanoMs: 5400,
  nanoUsed: true,
  reduced: false,
  chars: 287,
  v: 1,
});

describe('events (audit log)', () => {
  it('a signed-in client can append a content-free event', async () => {
    const db = env.authenticatedContext('anon-1').firestore();
    await assertSucceeds(addDoc(collection(db, 'events'), good('anon-1')));
  });

  it('signed-out clients cannot write', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(addDoc(collection(db, 'events'), good('x')));
  });

  it('cannot impersonate another uid', async () => {
    const db = env.authenticatedContext('anon-1').firestore();
    await assertFails(addDoc(collection(db, 'events'), good('someone-else')));
  });

  it('rejects text smuggled into a count value', async () => {
    const db = env.authenticatedContext('anon-1').firestore();
    await assertFails(addDoc(collection(db, 'events'), { ...good('anon-1'), counts: { PERSON: 'Priya Shah' } }));
  });

  it('rejects unknown fields (e.g. the pasted text itself)', async () => {
    const db = env.authenticatedContext('anon-1').firestore();
    await assertFails(addDoc(collection(db, 'events'), { ...good('anon-1'), text: 'Our client Priya Shah…' }));
  });

  it('rejects unknown entity types and text in site', async () => {
    const db = env.authenticatedContext('anon-1').firestore();
    await assertFails(addDoc(collection(db, 'events'), { ...good('anon-1'), counts: { SECRET_NOTE: 1 } }));
    await assertFails(addDoc(collection(db, 'events'), { ...good('anon-1'), site: 'Priya Shah owes $4.2M' }));
  });

  it('rejects client-chosen timestamps', async () => {
    const db = env.authenticatedContext('anon-1').firestore();
    await assertFails(addDoc(collection(db, 'events'), { ...good('anon-1'), ts: new Date(0) }));
  });

  it('nobody can read events except admins; nobody can edit or delete', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins/admin-1'), { role: 'admin' });
      await setDoc(doc(ctx.firestore(), 'events/e1'), { ...good('anon-1'), ts: new Date() });
    });
    const user = env.authenticatedContext('anon-1').firestore();
    const admin = env.authenticatedContext('admin-1').firestore();
    await assertFails(getDocs(collection(user, 'events')));
    await assertSucceeds(getDocs(collection(admin, 'events')));
    await assertFails(updateDoc(doc(admin, 'events/e1'), { total: 0 }));
    await assertFails(deleteDoc(doc(admin, 'events/e1')));
  });

  it('users cannot make themselves admin', async () => {
    const db = env.authenticatedContext('anon-1').firestore();
    await assertFails(setDoc(doc(db, 'admins/anon-1'), { role: 'admin' }));
  });
});
