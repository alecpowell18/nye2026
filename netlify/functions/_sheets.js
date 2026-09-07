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

// Looks up a guest by exact full-name match against the Guests!A:B tab
// (Name, MaxParty). Returns { name, maxParty } or null.
async function findGuest(sheets, inputName) {
  const target = norm(inputName);
  if (!target) return null;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Guests!A:B',
  });
  const rows = res.data.values || [];
  const match = rows.find((r) => norm(r[0]) === target);
  if (!match) return null;

  return {
    name: match[0],
    maxParty: parseInt(match[1], 10) || 8,
  };
}

// Finds an existing RSVP row for a guest name in RSVPs!A:F
// (Timestamp, Name, Attending, PartySize, Dietary, SongRequest).
// Returns { rowNumber, attending, partySize, dietary, songRequest } or null.
async function findExistingRsvp(sheets, guestName) {
  const target = norm(guestName);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'RSVPs!A:F',
  });
  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => norm(r[1]) === target);
  if (idx === -1) return null;

  const row = rows[idx];
  return {
    rowNumber: idx + 1, // 1-based sheet row, since range starts at row 1
    attending: row[2] === 'YES',
    partySize: parseInt(row[3], 10) || 1,
    dietary: row[4] || '',
    songRequest: row[5] || '',
  };
}

module.exports = { norm, checkEnv, getSheetsClient, findGuest, findExistingRsvp };
