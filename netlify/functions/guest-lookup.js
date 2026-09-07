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

  const inputName = String(data.name || '').trim();
  if (inputName.length < 2) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ found: false }),
    };
  }

  const envErr = checkEnv();
  if (envErr) {
    return { statusCode: 500, body: JSON.stringify({ error: envErr }) };
  }

  try {
    const sheets = await getSheetsClient();
    const guest = await findGuest(sheets, inputName);

    if (!guest) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ found: false }),
      };
    }

    const existing = await findExistingRsvp(sheets, guest.name);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        found: true,
        name: guest.name,
        maxParty: guest.maxParty,
        existingRsvp: existing
          ? {
              attending: existing.attending,
              partySize: existing.partySize,
              dietary: existing.dietary,
              songRequest: existing.songRequest,
            }
          : null,
      }),
    };
  } catch (err) {
    console.error('Guest lookup error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Lookup failed' }) };
  }
};
