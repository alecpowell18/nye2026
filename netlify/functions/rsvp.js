const { norm, checkEnv, getSheetsClient, findParty, getPartyRsvps } = require('./_sheets');

async function saveRsvp(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
  const partyId = typeof data.partyId === 'string' ? data.partyId.trim() : '';
  const responses = Array.isArray(data.responses) ? data.responses : [];
  const songRequest = typeof data.songRequest === 'string' ? data.songRequest.trim() : '';
  const invalid = responses.some(r => !r || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 200 || typeof r.attending !== 'boolean' || (r.dietary != null && (typeof r.dietary !== 'string' || r.dietary.length > 1000)));
  if (invalid || songRequest.length > 500) return { statusCode: 400, body: JSON.stringify({ error: 'Please check the guest names and responses.' }) };
  if (new Set(responses.map(r => norm(r.name))).size !== responses.length) return { statusCode: 400, body: JSON.stringify({ error: 'Please list each guest only once.' }) };

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
    if ([...partyNames].some(name => !responses.some(r => norm(r.name) === name))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Please answer for everyone in your party.' }) };
    }
    const extras = responses.filter(r => !partyNames.has(norm(r.name)));
    if (extras.length && (!responses.some(r => partyNames.has(norm(r.name)) && r.attending) || extras.some(r => !r.attending))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Added guests must accompany an attending member of your party.' }) };
    }
    if (responses.some(r => (r.dietary || '').split(',').map(x => x.trim()).includes('None') && (r.dietary || '').split(',').length > 1)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Choose either no restrictions or specific dietary restrictions.' }) };
    }
    const { byName } = await getPartyRsvps(sheets, partyId, partyNames);
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

    const updates = [];
    const appends = [];
    const submittedNames = new Set();

    responses.forEach((r) => {
      const name = String(r.name || '').trim();
      if (!name) return;

      const isOfficial = partyNames.has(norm(name));
      if (submittedNames.has(norm(name))) return;
      submittedNames.add(norm(name));

      const attending = isOfficial ? !!r.attending : true; // added guests always accompany the host
      const dietary = attending ? String(r.dietary || '').trim() || 'None' : 'None';
      const notes = !isOfficial && r.baby ? 'Baby' : '';
      const row = [timestamp, partyId, name, attending ? 'YES' : 'NO', dietary, songRequest, notes];
      const existing = byName[norm(name)];

      if (existing) {
        updates.push(
          sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SHEET_ID,
            range: `RSVPs!A${existing.rowNumber}:G${existing.rowNumber}`,
            valueInputOption: 'RAW',
            resource: { values: [row] },
          })
        );
      } else {
        appends.push(row);
      }
    });

    // Mark removed added guests as declined so they do not reappear on reload.
    for (const [name, existing] of Object.entries(byName)) {
      if (!partyNames.has(name) && !submittedNames.has(name)) {
        updates.push(sheets.spreadsheets.values.update({
          spreadsheetId: process.env.SHEET_ID,
          range: `RSVPs!D${existing.rowNumber}`,
          valueInputOption: 'RAW',
          resource: { values: [['NO']] },
        }));
      }
    }

    if (updates.length) await Promise.all(updates);
    if (appends.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SHEET_ID,
        range: 'RSVPs!A:G',
        valueInputOption: 'RAW',
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

// Serialize saves for a party in this warm function instance. Existing-sheet
// lookups also make completed retries update rows rather than append them.
// Cross-instance serialization still requires a shared durable coordinator.
const pending = new Map();
exports.handler = async event => {
  let key;
  try { key = JSON.parse(event.body)?.partyId; } catch { return saveRsvp(event); }
  if (typeof key !== 'string' || !key.trim()) return saveRsvp(event);
  key = key.trim();
  const previous = pending.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => saveRsvp(event));
  pending.set(key, current);
  try { return await current; }
  finally { if (pending.get(key) === current) pending.delete(key); }
};
