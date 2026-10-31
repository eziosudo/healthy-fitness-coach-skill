'use strict';
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const kg = set => number(set.weight_kg ?? set.weight) * (/^(lb|lbs|磅)$/i.test(set.unit || '') ? 0.45359237 : 1);
function parseStructuredTrain(train) {
  const exercises = [];
  const allSets = [];
  let aerobicSeconds = 0, distance = 0, hasCardio = false;
  function visit(name, set, parentDone = true) {
    if (!parentDone || set.done !== true) return;
    if (Array.isArray(set.items)) {
      for (const item of set.items) visit(item.name, item.set || {}, true);
      return;
    }
    if (set.metrics) {
      hasCardio = true;
      aerobicSeconds += number(set.metrics.workoutTime ?? set.time);
      distance += number(set.metrics.distance);
      return;
    }
    const strength = set.weight !== undefined || set.weight_kg !== undefined || set.reps !== undefined || set.selfWeight === true;
    if (strength) {
      const entry = { name, weight_kg: kg(set), reps: number(set.reps), volume: kg(set) * number(set.reps) };
      allSets.push(entry);
      let exercise = exercises.find(x => x.name === name);
      if (!exercise) { exercise = { name, sets: 0, total_reps: 0, volume: 0, weight_kg: 0 }; exercises.push(exercise); }
      exercise.sets++; exercise.total_reps += entry.reps; exercise.volume += entry.volume; exercise.weight_kg = Math.max(exercise.weight_kg, entry.weight_kg);
    }
    for (const drop of set.dropSets || []) visit(name, { ...drop, done: drop.done ?? true });
  }
  for (const movement of train.movements || []) {
    if (movement.cardio || movement.metrics) {
      hasCardio = true;
      aerobicSeconds += number(movement.metrics?.workoutTime ?? movement.workoutTime ?? movement.duration_s);
      distance += number(movement.metrics?.distance);
    }
    for (const set of movement.sets || []) visit(movement.name, set);
  }
  const start = number(train.start ?? train.started_at), end = number(train.end ?? train.ended_at);
  const duration = end > start ? (end - start) / 60000 : aerobicSeconds / 60;
  const strength = allSets.length > 0 || /功能性力量|functional.*strength/i.test(train.title || '');
  const warnings = [];
  if (train.truncated || train.movements?.some(m => m.truncated)) warnings.push('truncated_data');
  return {
    record_date: train.datestr, id: String(train.localid ?? ''), localid: train.localid,
    title: train.title || '', name: train.title || '', data_source: train.source || train.data_source || 'xunji',
    kind: strength ? 'resistance' : (hasCardio ? 'aerobic' : 'unknown'),
    duration_min: duration, ...(hasCardio ? { distance_km: distance } : {}),
    sets: allSets.length, total_reps: allSets.reduce((s,x) => s+x.reps,0),
    volume: allSets.reduce((s,x) => s+x.volume,0), volume_unit: 'kg',
    exercises, movements: train.movements || [], train: structuredClone(train),
    parse_status: warnings.length ? 'partial' : 'complete', ...(warnings.length ? { warnings } : {})
  };
}
module.exports = { parseStructuredTrain };
