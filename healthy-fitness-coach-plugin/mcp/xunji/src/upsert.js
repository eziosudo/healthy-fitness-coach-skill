'use strict';
const { connectorError } = require('./errors.js');
const { assertDate } = require('./schemas.js');
function validateUpsertRecords(records, { now = Date.now() } = {}) {
  if (!Array.isArray(records) || !records.length) throw connectorError('invalid_upsert');
  if (records.length > 4) throw connectorError('record_limit');
  if (records.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw connectorError('invalid_upsert');
  const date = assertDate(records[0].datestr);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  function bound(offset) {
    const [y,m,d] = today.split('-').map(Number);
    const first = new Date(Date.UTC(y,m-1+offset,1));
    const last = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
    first.setUTCDate(Math.min(d,last)); return first.toISOString().slice(0,10);
  }
  if (date < bound(-6) || date > bound(6)) throw connectorError('invalid_upsert');
  function setValid(set, nested = false) {
    if (!set || typeof set !== 'object') return false;
    if (set.items) return !nested && Array.isArray(set.items) && set.items.length > 0 && set.items.every(i => named(i) && setValid(i.set,true));
    if (!['weight','weight_kg','reps','time','duration_s','selfWeight'].some(k => set[k] !== undefined)) return false;
    if (set.rpe !== undefined && !['','6','6.5','7','7.5','8','8.5','9','9.5','10'].includes(set.rpe)) return false;
    if (set.dropSets && (!Array.isArray(set.dropSets) || set.dropSets.some(s => !setValid(s,true)))) return false;
    return !set.items;
  }
  function named(m) { return m && typeof m.name === 'string' && /[\u3400-\u9fff]/.test(m.name) && !Object.hasOwn(m,'key'); }
  for (const train of records) {
    if (assertDate(train.datestr) !== date) throw connectorError('mixed_dates');
    if (train.localid !== undefined && (!train.localid || !Number.isFinite(train.start) || !Number.isFinite(train.end))) throw connectorError('invalid_upsert');
    if (!Array.isArray(train.movements) || !train.movements.length) throw connectorError('invalid_upsert');
    let moves = 0;
    for (const m of train.movements) {
      if (!named(m) || (m.difficulty !== undefined && !['easy','normal','hard'].includes(m.difficulty))) throw connectorError('invalid_upsert');
      for (const field of ['restTime','warn_restTime']) if (m[field] !== undefined && (!Number.isFinite(m[field]) || m[field] < 0 || m[field] > 86400)) throw connectorError('invalid_upsert');
      if (m.cardio === true) { if (m.sets !== undefined || !m.metrics || typeof m.metrics !== 'object') throw connectorError('invalid_upsert'); moves++; continue; }
      if (!Array.isArray(m.sets) || !m.sets.length || m.sets.length > 20 || !m.sets.every(s => setValid(s))) throw connectorError('invalid_upsert');
      moves += Math.max(1,...m.sets.map(s => s.items?.length || 1));
    }
    if (moves > 15) throw connectorError('invalid_upsert');
  }
  return { date, records: structuredClone(records), parsed: records.map(r => ({date:r.datestr, ...(r.localid ? {id:String(r.localid)} : {})})), existing_ids: records.filter(r => r.localid !== undefined).length, new_records: records.filter(r => r.localid === undefined).length };
}
module.exports = { validateUpsertRecords };
