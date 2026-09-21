const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/rsvp.js'), 'utf8');
function setup() {
  const rows = []; const writes = [];
  const norm = s => s.toLowerCase().trim();
  const helpers = {
    norm, checkEnv: () => null,
    findParty: async (_, id) => id === 'party' ? [{ name: 'One Guest' }, { name: 'Two Guest' }] : [],
    getPartyRsvps: async () => ({ byName: Object.fromEntries(rows.map((r,i) => [norm(r[2]), { rowNumber:i+1 }])) }),
    getSheetsClient: async () => ({ spreadsheets: { values: {
      update: async x => { writes.push(x); const index = Number(x.range.match(/\d+/)[0])-1; if (x.range.includes(':G')) rows[index] = x.resource.values[0]; else rows[index][3]='NO'; },
      append: async x => { writes.push(x); rows.push(...x.resource.values); }
    } } })
  };
  const scope = { exports: {}, require: () => helpers, process: { env: { SHEET_ID:'test' } }, console };
  vm.runInNewContext(source, scope);
  return { rows, writes, save: (responses, overrides={}) => scope.exports.handler({ httpMethod:'POST', body:JSON.stringify({partyId:'party',responses,songRequest:'=1+1',...overrides}) }) };
}
const guests = () => [{ name:'One Guest', attending:true },{name:'Two Guest', attending:false},{name:'Added One',attending:true,dietary:'Vegan'},{name:'Added Two',attending:true,baby:true}];
test('multiple added guests, literal text, repeated and concurrent saves, and removal', async () => {
 const app=setup();
 const results=await Promise.all([app.save(guests()), app.save(guests())]);
 assert(results.every(r=>r.statusCode===200)); assert.equal(app.rows.length,4);
 assert(app.writes.every(w=>w.valueInputOption==='RAW'));
 assert.equal(app.rows[0][5],'=1+1'); assert.equal(app.rows[2][4],'Vegan'); assert.equal(app.rows[3][6],'Baby');
 await app.save(guests().slice(0,2)); assert.equal(app.rows[2][3],'NO'); assert.equal(app.rows[3][3],'NO');
});
test('invalid submissions are rejected without writing', async () => {
 for(const responses of [guests().slice(1), [...guests(),guests()[0]], guests().map(r=>({...r,attending:'yes'})), guests().map(r=>({...r,attending:false})), guests().map(r=>({...r,dietary:'None, Vegan'}))]) {
  const app=setup();assert.equal((await app.save(responses)).statusCode,400);assert.equal(app.writes.length,0);
 }
 const app=setup();assert.equal((await app.save(guests(),{partyId:'unknown'})).statusCode,403);
});
test('inline script parses and calendar crosses midnight in Pacific time', () => {
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 new vm.Script(html.split('<script>')[1].split('</script>')[0]);
 const ics=fs.readFileSync(path.join(__dirname,'../reception.ics'),'utf8');
 assert(ics.includes('DTSTART:20270101T020000Z'));assert(ics.includes('DTEND:20270101T083000Z'));
 assert(!html.includes('id="step-party"'));
});

test('countdown reaches zero at midnight Pacific and stays there', () => {
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const code=html.slice(html.indexOf('const TARGET'),html.indexOf('tick(); setInterval'));
 for (const [time,seconds,title] of [['2027-01-01T07:59:59Z','01',undefined],['2027-01-01T08:00:00Z','00','Happy New Year!'],['2027-01-01T09:00:00Z','00','Happy New Year!']]) {
  const nodes={};
  class Clock extends Date { static now(){return Date.parse(time);} }
  vm.runInNewContext(code+'tick();',{Date:Clock,document:{getElementById:id=>nodes[id]??=( {})}});
  assert.equal(nodes['cd-secs'].textContent,seconds);
  assert.equal(nodes['cd-hours'].textContent,'00');
  assert.equal(nodes['countdown-title']?.textContent,title);
 }
});
