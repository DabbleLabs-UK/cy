<?php
declare(strict_types=1);

require_once __DIR__ . '/autobiographical_memory.php';

// A read-only consumer of the canonical store, not a correspondence archive.
// PUBLIC_RECALLABLE + public_summary is the existing explicit public-safe
// representation. Archive visibility, names and anonymisation grant nothing.
const CY_ASSOCIATIVE_LIMIT = 2;
const CY_ASSOCIATIVE_CHARS = 260;

function captive_associative_terms(string $text): array
{
    $stop = explode(' ', 'the and that this with from have has had was were are you your yours they their them she her his him for but not can could would should what which when where how why who been being did does don its our out just really hello thanks thank please okay again about some any more very still someone anyone everyone somebody anybody everybody something anything everything nothing myself yourself himself herself itself ourselves yourselves themselves own each every either neither both other another such those these there here then than because into onto through among between while also only even much');
    return array_values(array_diff(captive_memory_tokens($text), $stop));
}

function captive_associative_source_keys(array $source): array
{
    $type = (string)($source['source_type'] ?? '');
    $id = (string)($source['source_id'] ?? '');
    if ($type === '' || $id === '') return [];
    $keys = ['source:' . $type . ':' . $id];
    if (in_array($type, ['POSTCARD', 'CY_REPLY'], true)
        && preg_match('/^postcard(?:-reply)?:([1-9][0-9]*)$/', $id, $m)) {
        $keys[] = 'exchange:' . $m[1];
    }
    foreach (['social_episode', 'movement_episode', 'search_episode', 'instrumental_episode'] as $field) {
        $episode = trim((string)($source[$field] ?? ''));
        if ($episode === '' || $episode === 'null') continue;
        $keys[] = preg_match('/^postcard:([1-9][0-9]*)$/', $episode, $m)
            ? 'exchange:' . $m[1] : 'episode:' . $episode;
    }
    return array_values(array_unique($keys));
}

function captive_associative_rank(array $rows, array $sources, array $query, ?string $sender, array $exclude = []): array
{
    $terms = captive_associative_terms((string)($query['text'] ?? ''));
    if (!$terms) return [];
    $ranked = [];
    foreach ($rows as $row) {
        $id = (string)$row['id'];
        if (($row['status'] ?? '') !== 'ACTIVE' || in_array($id, $exclude, true)) continue;
        $subject = $row['subject_visitor_id'] ?? null;
        if ($subject !== null && $sender !== null && $subject === $sender) continue;
        $public = ($row['privacy_scope'] ?? '') === 'PUBLIC_RECALLABLE';
        if (!$public && (($row['privacy_scope'] ?? '') !== 'INTERNAL_ONLY' || $subject !== null)) continue;
        $origin = (string)($row['origin_kind'] ?? '');
        if (!in_array($origin, ['POSTCARD', 'CY_REPLY', 'ENVIRONMENT_EVENT', 'AMBIENT_EVENT',
            'CY_EXPRESSION', 'DREAM_EXPRESSION', 'USER_APPROVED_SPEC'], true)) continue;
        $refs = $sources[$id] ?? [];
        // Partial/unlinked provenance cannot establish deduplication or privacy.
        if (!$refs || count($refs) !== (int)($row['source_count'] ?? 0)) continue;
        $correspondence = in_array($origin, ['POSTCARD', 'CY_REPLY'], true);
        $privateSource = false; $consequence = false;
        $keys = [];
        foreach ($refs as $ref) {
            $correspondence = $correspondence || in_array($ref['source_type'], ['POSTCARD', 'CY_REPLY'], true);
            $correspondence = $correspondence || in_array($ref['source_event_type'] ?? '', ['postcard', 'postcard_with_image', 'postcard_reply'], true);
            $privateSource = $privateSource || ($ref['source_visibility'] ?? '') === 'SENDER_RECALLABLE';
            $consequence = $consequence || !empty($ref['consequence_id']);
            $keys = array_merge($keys, captive_associative_source_keys($ref));
        }
        foreach ($keys as $key) if (str_starts_with($key, 'exchange:')) $correspondence = true;
        // Legacy unlinked environment copies of mail are not prison experience.
        // Unknown/mixed correspondence origin cannot acquire an experience label.
        if ($correspondence && !in_array($origin, ['POSTCARD', 'CY_REPLY'], true)) continue;
        if (!$public && ($correspondence || $privateSource)) continue;
        $content = trim((string)($public ? ($row['public_summary'] ?? '') : ($row['content'] ?? '')));
        // Do not cut off a qualification/negation to manufacture a short fact.
        if ($content === '' || mb_strlen($content) > CY_ASSOCIATIVE_CHARS || !$keys) continue;
        // Score ONLY text safe for this consumer. Private content/tags cannot
        // make an unrelated public summary appear relevant.
        $words = captive_associative_terms($content);
        $matches = array_values(array_intersect($terms, $words));
        if (!$matches) continue;
        $tags = array_intersect(captive_memory_tags(explode(',', (string)($row['tags'] ?? ''))), $matches);
        $sourceTimes = array_filter(array_map(static fn(array $s): int => strtotime((string)($s['source_timestamp'] ?? '')) ?: 0, $refs));
        $row['_rank'] = [count($matches), count($tags), ($row['memory_type'] ?? '') === 'UNRESOLVED_THREAD' ? 1 : 0,
            $consequence ? 1 : 0,
            $sourceTimes ? max($sourceTimes) : 0];
        $row['_content'] = $content;
        $row['_keys'] = array_values(array_unique($keys));
        $ranked[] = $row;
    }
    usort($ranked, static function (array $a, array $b): int {
        for ($i = 0; $i < 5; $i++) if ($a['_rank'][$i] !== $b['_rank'][$i]) return $b['_rank'][$i] <=> $a['_rank'][$i];
        return strcmp($a['id'], $b['id']);
    });
    return $ranked;
}

function captive_associative_select(array $ranked, array $sources): array
{
    // Union overlapping provenance BEFORE selection, including bridge memories.
    // A+B, B+C, C are one underlying group, not two available prompt slots.
    $parent = [];
    $find = static function (string $x) use (&$parent, &$find): string {
        $parent[$x] ??= $x;
        return $parent[$x] === $x ? $x : ($parent[$x] = $find($parent[$x]));
    };
    foreach ($ranked as $row) {
        $first = $row['_keys'][0];
        foreach ($row['_keys'] as $key) $parent[$find($key)] = $find($first);
    }
    $used = []; $selected = [];
    foreach ($ranked as $row) {
        $group = $find($row['_keys'][0]);
        if (isset($used[$group])) continue;
        $used[$group] = true;
        $selected[] = [
            'id' => $row['id'], 'type' => $row['memory_type'], 'status' => 'ACTIVE',
            'privacyScope' => $row['privacy_scope'], 'subjectVisitorId' => $row['subject_visitor_id'],
            'originKind' => $row['origin_kind'], 'consistencyStatus' => $row['consistency_status'],
            'content' => mb_substr($row['_content'], 0, CY_ASSOCIATIVE_CHARS),
            'publicSummary' => $row['privacy_scope'] === 'PUBLIC_RECALLABLE'
                ? mb_substr($row['_content'], 0, CY_ASSOCIATIVE_CHARS) : null,
            'sourceKeys' => $row['_keys'],
            'sourceRefs' => array_map(static fn(array $s): array => [
                'type' => $s['source_type'], 'id' => $s['source_id'], 'visibility' => $s['source_visibility'],
            ], $sources[$row['id']]),
            'version' => (int)$row['version'],
        ];
        if (count($selected) === CY_ASSOCIATIVE_LIMIT) break;
    }
    return $selected;
}

function captive_postcard_associations(PDO $db, array $query, ?string $sender, array $exclude = []): array
{
    $terms = captive_associative_terms(mb_substr((string)($query['text'] ?? ''), 0, 2000));
    if (!$terms) return ['candidates' => [], 'consideredIds' => []];
    // Reuse the existing whole-store FTS index. Filter the lane's scope BEFORE
    // the bounded pool, so private/current-sender rows cannot crowd it out.
    $scope = "status = 'ACTIVE' AND ((privacy_scope = 'PUBLIC_RECALLABLE' AND public_summary IS NOT NULL AND TRIM(public_summary) <> '')
        OR (privacy_scope = 'INTERNAL_ONLY' AND subject_visitor_id IS NULL))";
    $scopeParams = [];
    if ($sender !== null) {
        $scope .= ' AND (subject_visitor_id IS NULL OR subject_visitor_id <> ?)';
        $scopeParams[] = $sender;
    }
    $stmt = $db->prepare("SELECT id, MATCH(content, public_summary) AGAINST (? IN BOOLEAN MODE) AS score
        FROM autobiographical_memories WHERE $scope HAVING score > 0 ORDER BY score DESC, id ASC LIMIT 200");
    $stmt->execute(array_merge([implode(' ', array_map(static fn(string $t): string => $t . '*', $terms))], $scopeParams));
    $rows = captive_memory_rows_by_ids($db, array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'id'));
    if (!$rows) return ['candidates' => [], 'consideredIds' => []];
    $ids = array_column($rows, 'id');
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $db->prepare("SELECT s.memory_id, s.source_type, s.source_id, s.source_timestamp, s.source_visibility, e.event_type AS source_event_type,
        JSON_UNQUOTE(JSON_EXTRACT(e.record, '$.world_event.world.social.episode_id')) AS social_episode,
        JSON_UNQUOTE(JSON_EXTRACT(e.record, '$.world_event.world.movement.episode_id')) AS movement_episode,
        JSON_UNQUOTE(JSON_EXTRACT(e.record, '$.world_event.world.search_episode.id')) AS search_episode,
        CASE WHEN JSON_EXTRACT(e.record, '$.world_event.world.instrumental') IS NOT NULL THEN
            JSON_UNQUOTE(JSON_EXTRACT(e.record, '$.world_event.world.defensive_context.context_id')) END AS instrumental_episode,
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.record, '$.world_event.world.instrumental.consequence_id')), 'null') AS consequence_id
        FROM autobiographical_memory_sources s LEFT JOIN environment_events e
        ON s.source_type IN ('ENVIRONMENT_EVENT','AMBIENT_EVENT') AND e.event_id = s.source_id
        WHERE s.memory_id IN ($placeholders) ORDER BY s.memory_id, s.source_type, s.source_id LIMIT 4000");
    $stmt->execute($ids);
    $sources = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) $sources[$row['memory_id']][] = $row;
    $ranked = captive_associative_rank($rows, $sources, $query, $sender, $exclude);
    return ['candidates' => captive_associative_select($ranked, $sources),
        'consideredIds' => array_column($ranked, 'id')];
}
