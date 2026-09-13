<?php
declare(strict_types=1);

const CAPTIVE_POWER_HISTORY_MINUTES = 30;
const CAPTIVE_POWER_HISTORY_MAX_ROWS = 700;

function captive_power_history_cutoff(DateTimeImmutable $now): string
{
    return $now
        ->sub(new DateInterval('PT' . CAPTIVE_POWER_HISTORY_MINUTES . 'M'))
        ->format('Y-m-d H:i:s.u');
}

