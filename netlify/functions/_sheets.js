const { google } = require('googleapis');

function norm(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function checkEnv() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) return 'GOOGLE_SERVICE_ACCOUNT env var is not set';
  if (!process.env.SHEET_ID) return 'SHEET_ID env var is not set';
  return null;
}

async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Guests!A:C = PartyID, First Name, Last Name.
// Multiple rows sharing a PartyID are linked together (couples/families).
async function getAllGuests(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Guests!A:C',
  });
  const rows = res.data.values || [];
  return rows
    .filter((r) => r[0] && r[1] && r[2])
    .map((r) => ({
      partyId: String(r[0]).trim(),
      firstName: String(r[1]).trim(),
      lastName: String(r[2]).trim(),
      name: `${String(r[1]).trim()} ${String(r[2]).trim()}`,
    }));
}

// Exact first+last match against the Guests tab. Returns the matching
// guest's row or null; no partial/substring matching.
async function findGuestByName(sheets, firstName, lastName) {
  const targetFirst = norm(firstName);
  const targetLast = norm(lastName);
  if (!targetFirst || !targetLast) return null;

  const guests = await getAllGuests(sheets);
  return (
    guests.find((g) => norm(g.firstName) === targetFirst && norm(g.lastName) === targetLast) ||
    null
  );
}

// All guests sharing a PartyID, in sheet order.
async function findParty(sheets, partyId) {
  const guests = await getAllGuests(sheets);
  return guests.filter((g) => g.partyId === partyId);
}

// Solo parties (exactly one registered name) may bring along guests who
// aren't on the Guests tab (e.g. a plus-one or a baby); capped so the
// feature can't be used to smuggle in an unbounded number of extra invites.
const MAX_ADDED_GUESTS = 1;

// RSVPs!A:G = Timestamp, PartyID, Name, Attending, Dietary, SongRequest, Notes.
// One row per person; dietary/song are shared across the party and
// duplicated onto each person's row for simplicity. `officialNames` (a Set
// of normalized full names) distinguishes registered party members from
// guests someone added themselves; anything not in the set is "added".
async function getPartyRsvps(sheets, partyId, officialNames) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'RSVPs!A:G',
  });
  const rows = res.data.values || [];

  const byName = {};
  const addedGuests = [];
  let dietary = '';
  let songRequest = '';

  rows.forEach((row, idx) => {
    if (norm(row[1]) !== norm(partyId)) return;
    const name = row[2] || '';
    byName[norm(name)] = {
      rowNumber: idx + 1, // 1-based sheet row, since range starts at row 1
      attending: row[3] === 'YES',
    };
    if (row[4]) dietary = row[4];
    if (row[5]) songRequest = row[5];
    if (!officialNames.has(norm(name))) {
      addedGuests.push({ name, baby: (row[6] || '').toLowerCase() === 'baby' });
    }
  });

  return { byName, dietary, songRequest, addedGuests };
}

module.exports = {
  norm,
  checkEnv,
  getSheetsClient,
  findGuestByName,
  findParty,
  getPartyRsvps,
  MAX_ADDED_GUESTS,
};
