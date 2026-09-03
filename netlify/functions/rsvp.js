const { google } = require('googleapis');

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

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'RSVPs!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
          name,
          attending ? 'YES' : 'NO',
          attending ? String(partySize) : '0',
          dietary || 'None',
          songRequest || '',
        ]],
      },
    });

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
