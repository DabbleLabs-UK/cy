<?php
declare(strict_types=1);

// RETIRED - no longer called anywhere.
//
// Postcards used to be queued for the next of three fixed daily mail drops
// (08:00/13:00/19:00 Europe/London), which meant up to hours of delay before a
// postcard reached Cy. Delivery is now INSTANT: post-postcard.php stamps
// deliver_at with the current UTC time, and the runner's ~3s inbox poll picks it
// up within seconds. This function is kept, unused, only for reference / history.
//
// Next mail-drop slot (08:00, 13:00, 19:00 Europe/London), returned as a
// UTC "Y-m-d H:i:s" string for storage, since the server/DB run in UTC.
function captive_next_deliver_at(): string
{
    $london = new DateTimeZone('Europe/London');
    $utc = new DateTimeZone('UTC');
    $now = new DateTime('now', $london);
    $slots = ['08:00', '13:00', '19:00'];

    foreach ($slots as $slot) {
        $candidate = DateTime::createFromFormat('Y-m-d H:i', $now->format('Y-m-d') . ' ' . $slot, $london);
        if ($candidate > $now) {
            return $candidate->setTimezone($utc)->format('Y-m-d H:i:s');
        }
    }

    $tomorrow = (clone $now)->modify('+1 day');
    $candidate = DateTime::createFromFormat('Y-m-d H:i', $tomorrow->format('Y-m-d') . ' ' . $slots[0], $london);
    return $candidate->setTimezone($utc)->format('Y-m-d H:i:s');
}
