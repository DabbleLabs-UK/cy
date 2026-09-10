<?php
declare(strict_types=1);

const CY_IMPLEMENTATION_STATUSES = ['IMPLEMENTED', 'PROVISIONAL', 'NOT_IMPLEMENTED'];

function captive_implementation_registry_path(): string
{
    return __DIR__ . '/../config/implementation-registry.json';
}

function captive_implementation_registry(?string $path = null): array
{
    static $cached = null;
    $useCache = $path === null;
    if ($useCache && is_array($cached)) {
        return $cached;
    }

    $json = file_get_contents($path ?? captive_implementation_registry_path());
    if ($json === false) {
        throw new RuntimeException('implementation registry is unavailable');
    }
    $registry = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($registry)
        || ($registry['schema'] ?? null) !== 'cy.implementation-registry'
        || !isset($registry['soma_variables'], $registry['brain_regions'])
        || !is_array($registry['soma_variables'])
        || !is_array($registry['brain_regions'])) {
        throw new RuntimeException('implementation registry is invalid');
    }

    foreach (['soma_variables', 'brain_regions'] as $scope) {
        $seen = [];
        foreach ($registry[$scope] as $entry) {
            $id = is_array($entry) ? (string)($entry['id'] ?? '') : '';
            $status = is_array($entry) ? (string)($entry['implementation_status'] ?? '') : '';
            if ($id === '' || isset($seen[$id]) || !in_array($status, CY_IMPLEMENTATION_STATUSES, true)) {
                throw new RuntimeException('implementation registry contains an invalid entry');
            }
            $seen[$id] = true;
        }
    }

    if ($useCache) {
        $cached = $registry;
    }
    return $registry;
}

function captive_implementation_registry_entry(array $registry, string $scope, string $id): ?array
{
    foreach ($registry[$scope] ?? [] as $entry) {
        if (is_array($entry) && ($entry['id'] ?? null) === $id) {
            return $entry;
        }
    }
    return null;
}

function captive_implementation_public_label(array $registry, string $status): string
{
    return (string)($registry['statuses'][$status]['public_label'] ?? match ($status) {
        'IMPLEMENTED' => 'LIVE',
        'PROVISIONAL' => 'PROVISIONAL',
        default => 'NOT MODELLED',
    });
}

function captive_implementation_overall_status(array $registry): string
{
    $statuses = array_map(
        static fn(array $entry): string => (string)($entry['implementation_status'] ?? 'NOT_IMPLEMENTED'),
        $registry['soma_variables'] ?? []
    );
    if ($statuses && count(array_unique($statuses)) === 1 && $statuses[0] === 'IMPLEMENTED') {
        return 'implemented';
    }
    if (in_array('PROVISIONAL', $statuses, true) || in_array('IMPLEMENTED', $statuses, true)) {
        return 'provisional';
    }
    return 'not_implemented';
}
