function abortError() {
  return new DOMException('shared Ollama lease request aborted', 'AbortError');
}

function cleanProfile(value) {
  const profile = value && typeof value === 'object' ? value : {};
  const numCtx = Number(profile.num_ctx);
  const numThread = Number(profile.num_thread);
  if (!Number.isInteger(numCtx) || numCtx < 512 || !Number.isInteger(numThread) || numThread < 1) {
    throw new Error('shared Ollama arbiter returned an invalid execution profile');
  }
  return { num_ctx: numCtx, num_thread: numThread };
}

export function createSharedOllamaClient(baseUrl, { fetchImpl = fetch } = {}) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  if (!root) return null;

  return {
    async acquire({ purpose = 'unknown', signal = null, onLost = () => {}, preemptible = false } = {}) {
      if (signal && signal.aborted) throw abortError();
      const response = await fetchImpl(`${root}/v1/acquire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: 'cy', priorityClass: 'cy', purpose }),
        signal,
      });
      if (!response.ok) throw new Error(`shared Ollama arbiter HTTP ${response.status}`);
      const grant = await response.json();
      const id = String(grant.id || '');
      if (!id) throw new Error('shared Ollama arbiter returned no lease ID');
      const profile = cleanProfile(grant.profile);
      const heartbeatMs = Math.max(1000, Number(grant.heartbeatMs) || 5000);
      let released = false;
      let heartbeatFailures = 0;
      let heartbeatBusy = false;
      const heartbeat = async () => {
        if (released || heartbeatBusy) return;
        heartbeatBusy = true;
        try {
          const result = await fetchImpl(`${root}/v1/leases/${encodeURIComponent(id)}/heartbeat`, {
            method: 'POST',
          });
          if (!result.ok) throw new Error(`heartbeat HTTP ${result.status}`);
          heartbeatFailures = 0;
          // A preemptible lease (CY's low-priority AWG background inference) can be
          // told by the arbiter that an interactive request is now queued behind
          // it. This never applies to interactive/foreground leases, which do not
          // opt in. Reusing the existing LEASE_LOSS abort path releases the model
          // promptly without any new cancellation machinery.
          if (preemptible && !released) {
            const body = await result.json().catch(() => null);
            if (body && body.interactiveWaiting) onLost('LEASE_PREEMPTED');
          }
        } catch {
          heartbeatFailures += 1;
          if (heartbeatFailures >= 2 && !released) onLost('LEASE_LOSS');
        } finally {
          heartbeatBusy = false;
        }
      };
      const timer = setInterval(() => { void heartbeat(); }, heartbeatMs);
      if (typeof timer.unref === 'function') timer.unref();

      return {
        id,
        profile,
        waitMs: Math.max(0, Number(grant.waitMs) || 0),
        async release() {
          if (released) return;
          released = true;
          clearInterval(timer);
          try {
            await fetchImpl(`${root}/v1/leases/${encodeURIComponent(id)}`, { method: 'DELETE' });
          } catch {
            // Lease expiry is the fail-safe if the local release cannot reach the arbiter.
          }
        },
      };
    },
  };
}

export function applySharedOllamaProfile(options, lease) {
  return lease && lease.profile ? { ...(options || {}), ...lease.profile } : { ...(options || {}) };
}
