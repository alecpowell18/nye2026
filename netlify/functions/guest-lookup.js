const { norm, checkEnv, getSheetsClient, findGuestByName, findParty, getPartyRsvps } = require('./_sheets');

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

  const firstName = String(data.firstName || '').trim();
  const lastName = String(data.lastName || '').trim();
  if (!firstName || !lastName) {
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
    const guest = await findGuestByName(sheets, firstName, lastName);

    if (!guest) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ found: false }),
      };
    }

    const party = await findParty(sheets, guest.partyId);
    const officialNames = new Set(party.map((p) => norm(p.name)));
    const { byName, dietary, songRequest, addedGuests } = await getPartyRsvps(
      sheets,
      guest.partyId,
      officialNames
    );

    const members = party.map((p) => {
      const existing = byName[norm(p.name)];
      return {
        name: p.name,
        attending: existing ? existing.attending : null,
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        found: true,
        partyId: guest.partyId,
        members,
        dietary,
        songRequest,
        // Only solo parties are offered the "add a guest" option.
        canAddGuests: party.length === 1,
        addedGuests,
      }),
    };
  } catch (err) {
    console.error('Guest lookup error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Lookup failed' }) };
  }
};
