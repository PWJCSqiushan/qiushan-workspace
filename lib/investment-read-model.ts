// D1 performs the historical projection. Full authoritative histories remain
// in state_json; the Worker only parses the 61 closes needed by daily rules.
export const investmentReadState = `json_set(state_json,'$.snapshots',json(COALESCE((
 SELECT json_group_object(s.key,json(json_set(s.value,
 '$.history',json((SELECT COALESCE(json_group_array(json(h.value)),'[]') FROM
   (SELECT value FROM (SELECT key,value FROM json_each(s.value,'$.history') ORDER BY CAST(key AS INTEGER) DESC LIMIT 61) ORDER BY CAST(key AS INTEGER)) h)),
 '$.metrics.history_count',MIN(61,json_array_length(s.value,'$.history')),
 '$.history_windowed',CASE WHEN json_array_length(s.value,'$.history')>61 THEN 1 ELSE 0 END,
 '$.history_total_count',json_array_length(s.value,'$.history'))))
 FROM json_each(state_json,'$.snapshots') s),'{}')))`;

// A routine write uses a projected view. Restore the untouched historical rows
// inside the same CAS UPDATE; never round-trip them through the Worker heap.
// A portable restore deliberately bypasses this expression and writes its
// fully validated payload instead.
export const investmentPersistState = `json_set(?,'$.snapshots',json(COALESCE((
 SELECT json_group_object(cur.key,json(json_remove(json_set(cur.value,
 '$.history',json(CASE WHEN json_extract(cur.value,'$.history_windowed')=1 AND
   json_extract(cur.value,'$.snapshot_id')=json_extract(prior.value,'$.snapshot_id')
   THEN json_extract(prior.value,'$.history') ELSE json_extract(cur.value,'$.history') END),
 '$.metrics.history_count',CASE WHEN json_extract(cur.value,'$.history_windowed')=1 AND
   json_extract(cur.value,'$.snapshot_id')=json_extract(prior.value,'$.snapshot_id')
   THEN json_array_length(prior.value,'$.history') ELSE json_array_length(cur.value,'$.history') END),
 '$.history_windowed','$.history_total_count')))
 FROM json_each(?,'$.snapshots') cur LEFT JOIN json_each(investment_states.state_json,'$.snapshots') prior ON prior.key=cur.key),'{}')))`;

export const investmentExportState = `json_set(state_json,'$.version',version,'$.exports',json(COALESCE((
 SELECT json_group_object(binding.key,json(binding.value)) FROM (
  SELECT old.key,old.value FROM json_each(state_json,'$.exports') old
  WHERE NOT EXISTS(SELECT 1 FROM investment_export_bindings b WHERE b.owner_id=investment_states.owner_id AND b.space=investment_states.space AND b.snapshot_id=old.key)
  UNION ALL SELECT snapshot_id AS key,binding_json AS value FROM investment_export_bindings b
  WHERE b.owner_id=investment_states.owner_id AND b.space=investment_states.space
 ) binding),'{}')))`;
