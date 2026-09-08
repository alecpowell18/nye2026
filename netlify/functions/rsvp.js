const { norm, checkEnv, getSheetsClient, findParty, getPartyRsvps, MAX_ADDED_GUESTS } = require('./_sheets');

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

  const partyId = String(data.partyId || '').trim();
  const responses = Array.isArray(data.responses) ? data.responses : [];
  const dietary = data.dietary || 'None';
  const songRequest = data.songRequest || '';

  if (!partyId || responses.length === 0) {
    return { statusCode: 400, body: 'Missing partyId or responses' };
  }

  const envErr = checkEnv();
  if (envErr) {
    return { statusCode: 500, body: JSON.stringify({ error: envErr }) };
  }

  try {
    const sheets = await getSheetsClient();

    // Re-validate against the Guests tab rather than trusting whatever
    // names/partyId the client sends.
    const party = await findParty(sheets, partyId);
    if (party.length === 0) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Party not recognized' }) };
    }
    const partyNames = new Set(party.map((p) => norm(p.name)));
    // Only solo invites may add guests who aren't on the Guests tab
    // (e.g. a plus-one or a baby), and only up to the cap.
    const canAddGuests = party.length === 1;

    const { byName } = await getPartyRsvps(sheets, partyId, partyNames);
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

    const updates = [];
    const appends = [];
    let addedCount = 0;

    responses.forEach((r) => {
      const name = String(r.name || '').trim();
      if (!name) return;

      const isOfficial = partyNames.has(norm(name));
      if (!isOfficial) {
        if (!canAddGuests || addedCount >= MAX_ADDED_GUESTS) return;
        addedCount++;
      }

      const attending = isOfficial ? !!r.attending : true; // added guests always accompany the host
      const notes = !isOfficial && r.baby ? 'Baby' : '';
      const row = [timestamp, partyId, name, attending ? 'YES' : 'NO', dietary, songRequest, notes];
      const existing = byName[norm(name)];

      if (existing) {
        updates.push(
          sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SHEET_ID,
            range: `RSVPs!A${existing.rowNumber}:G${existing.rowNumber}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [row] },
          })
        );
      } else {
        appends.push(row);
      }
    });

    if (updates.length) await Promise.all(updates);
    if (appends.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'RSVPs!A:G',
        valueInputOption: 'USER_ENTERED',
        resource: { values: appends },
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
