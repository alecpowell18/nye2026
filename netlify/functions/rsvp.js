const { checkEnv, getSheetsClient, findGuest, findExistingRsvp } = require('./_sheets');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { name, attending, partySize, dietary, songRequest } = data;
  if (!name) return { statusCode: 400, body: 'Missing name' };

  const envErr = checkEnv();
  if (envErr) {
    return { statusCode: 500, body: JSON.stringify({ error: envErr }) };
  }

  try {
    const sheets = await getSheetsClient();

    // Re-validate against the guest list server-side rather than trusting
    // whatever name the client sends — the confirm step is just a UX nicety.
    const guest = await findGuest(sheets, name);
    if (!guest) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Name not recognized' }) };
    }

    const cappedParty = attending
      ? Math.min(Math.max(parseInt(partySize, 10) || 1, 1), guest.maxParty)
      : 0;

    const row = [
      new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
      guest.name,
      attending ? 'YES' : 'NO',
      String(cappedParty),
      dietary || 'None',
      attending ? (songRequest || '') : '',
    ];

    const existing = await findExistingRsvp(sheets, guest.name);

    if (existing) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SHEET_ID,
        range: `RSVPs!A${existing.rowNumber}:F${existing.rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'RSVPs!A:F',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] },
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Sheets error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to save RSVP' }),
    };
  }
};
