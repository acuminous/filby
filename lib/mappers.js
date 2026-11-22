function toChangeSet(row) {
  return {
    id: row.change_set_id,
    effective: new Date(row.effective),
    description: row.description,
    lastModified: new Date(row.last_modified),
    entityTag: row.entity_tag,
    reissuedFrom: row.reissued_from ?? undefined,
  };
}

function toProjection(row) {
  return {
    ...row,
    key: `${row.name} v${row.version}`,
  };
}

module.exports = { toChangeSet, toProjection };
