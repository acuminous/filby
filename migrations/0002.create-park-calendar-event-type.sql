START TRANSACTION;

CREATE TYPE park_calendar_event_type AS ENUM ('Park Open - Owners', 'Park Open - Guests', 'Park Close - Owners', 'Park Close - Guests');

END TRANSACTION;