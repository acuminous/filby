CREATE VIEW park_v1_changelog_vw AS (
  WITH park_change_set AS (
    SELECT
      cs.*
    FROM
      rdf_change_set cs
    INNER JOIN
      park_v1_data_frame park
    ON
      park.rdf_change_set_id = cs.id
  ), park_calendar_change_set AS (
    SELECT
      cs.*
    FROM
      rdf_change_set cs
    INNER JOIN
      park_calendar_v1_data_frame park_calendar
    ON
      park_calendar.rdf_change_set_id = cs.id
  )
  SELECT
    *
  FROM 
    park_change_set
  UNION
  SELECT 
    * 
  FROM 
    park_calendar_change_set
  ORDER BY
    id ASC
)    