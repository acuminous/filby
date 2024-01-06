const ReferenceDataFramework = require('..');

module.exports = class TestReferenceDataFramework extends ReferenceDataFramework {
  async wipe() {
    await this.withTransaction(async (tx) => {
      await tx.query('DELETE FROM vat_rate_v1');
      await tx.query('DELETE FROM rdf_notification');
      await tx.query('DELETE FROM rdf_hook');
      await tx.query('DELETE FROM rdf_data_frame');
      await tx.query('DELETE FROM rdf_projection_entity');
      await tx.query('DELETE FROM rdf_entity');
      await tx.query('DELETE FROM rdf_change_set');
      await tx.query('DELETE FROM rdf_projection');
    });
  }
}