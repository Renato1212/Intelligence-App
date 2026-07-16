/*
 * Rithmic trading connection — the foundation, built honestly.
 *
 * Rithmic's R | Protocol API is WebSockets + Google protocol buffers and is
 * explicitly designed to run in web browsers — so this app CAN speak to the
 * R | Trade Execution Platform directly, no middleman server. What Rithmic
 * gates is ACCESS, not technology: you request API access (rithmic.com/
 * api-request, or through your broker/prop firm), receive the dev kit (the
 * .proto message definitions + the test-system endpoint), build against the
 * test system, pass their conformance review, and only then get a registered
 * SYSTEM NAME + production credentials. Without a registered system name the
 * production gateways refuse the login handshake — that's a Rithmic policy,
 * not a missing feature here.
 *
 * This module is everything around that handshake, ready today:
 *  - a credentials vault that lives ON THIS DEVICE ONLY (never cloud-synced,
 *    excluded from backups/cache clears),
 *  - the environment/gateway model (test → paper → production),
 *  - a reachability probe for the chosen wss gateway,
 *  - a readiness checklist that tells the trader exactly which step of
 *    Rithmic's process they're on.
 * The protobuf login/market-data/order plants plug in on top the moment the
 * dev kit's proto files are available to this deployment.
 */

export interface RithmicConn {
  user: string;
  password: string;
  /** the registered app name Rithmic issues after conformance ('' until then) */
  systemName: string;
  env: 'test' | 'paper' | 'live';
  /** wss:// gateway address (prefilled for test; from your dev kit otherwise) */
  gatewayUrl: string;
  /**
   * The application identity Rithmic permissions the login against. Rithmic
   * ties access to (user, system, app) — a third-party app like MotiveWave
   * works because ITS app_name is registered/conformed. Leave blank to use the
   * app's own name; set the one your broker/Rithmic authorized for your login
   * if you get "permission denied".
   */
  appName?: string;
}

export interface RithmicEnv {
  id: RithmicConn['env'];
  label: string;
  defaultUrl: string;
  defaultSystem: string;
  note: string;
}

export const RITHMIC_ENVS: RithmicEnv[] = [
  {
    id: 'test',
    label: 'Rithmic Test',
    defaultUrl: 'wss://rituz00100.rithmic.com:443',
    defaultSystem: 'Rithmic Test',
    note: 'The development system every API applicant builds against — live CME market data, simulated accounts. Credentials come with the dev kit.',
  },
  {
    id: 'paper',
    label: 'Paper Trading',
    defaultUrl: '',
    defaultSystem: 'Rithmic Paper Trading',
    note: 'Rithmic\'s simulated-fill environment with your real login. Gateway address comes from your broker / the dev kit.',
  },
  {
    id: 'live',
    label: 'Production',
    defaultUrl: '',
    defaultSystem: '',
    note: 'The live R | Trade Execution Platform. Requires the conformance-approved system name — gateway + system name arrive with Rithmic\'s sign-off.',
  },
];

/* ------------------------------- the vault -------------------------------- */

export const RITHMIC_STORE_KEY = 'ei-rithmic-conn';

/** Pure: pack credentials for at-rest storage (obfuscation, not encryption —
 * the honest truth of any browser-local vault; it never leaves the device). */
export function packConn(c: RithmicConn): string {
  const json = JSON.stringify(c);
  try {
    return 'b64:' + btoa(unescape(encodeURIComponent(json)));
  } catch {
    return 'raw:' + json;
  }
}

/** Pure inverse of packConn; tolerant of junk. */
export function unpackConn(raw: string | null): RithmicConn | null {
  if (!raw) return null;
  try {
    const json = raw.startsWith('b64:') ? decodeURIComponent(escape(atob(raw.slice(4)))) : raw.startsWith('raw:') ? raw.slice(4) : raw;
    const c = JSON.parse(json) as Partial<RithmicConn>;
    if (typeof c.user !== 'string' || typeof c.password !== 'string') return null;
    const env: RithmicConn['env'] = c.env === 'paper' || c.env === 'live' ? c.env : 'test';
    return {
      user: c.user,
      password: c.password,
      systemName: typeof c.systemName === 'string' ? c.systemName : '',
      env,
      gatewayUrl: typeof c.gatewayUrl === 'string' ? c.gatewayUrl : '',
      appName: typeof c.appName === 'string' && c.appName.trim() ? c.appName.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function loadConn(): RithmicConn | null {
  try {
    return unpackConn(localStorage.getItem(RITHMIC_STORE_KEY));
  } catch {
    return null;
  }
}

export function saveConn(c: RithmicConn | null): void {
  try {
    if (c) localStorage.setItem(RITHMIC_STORE_KEY, packConn(c));
    else localStorage.removeItem(RITHMIC_STORE_KEY);
  } catch {
    // storage unavailable — nothing to persist
  }
}

/* ----------------------------- readiness model ---------------------------- */

export interface ReadinessStep {
  step: string;
  done: boolean;
  detail: string;
}

/** Pure: where the trader stands on Rithmic's actual onboarding path. */
export function connectionReadiness(c: RithmicConn | null): ReadinessStep[] {
  const hasCreds = !!(c && c.user.trim() && c.password.trim());
  const hasGateway = !!(c && /^wss:\/\/[a-z0-9.-]+(:\d+)?/i.test(c.gatewayUrl.trim()));
  const isTest = c?.env === 'test';
  const hasSystem = !!(c && (c.systemName.trim() || (isTest ? RITHMIC_ENVS[0].defaultSystem : '')));
  return [
    {
      step: 'Credentials saved on this device',
      done: hasCreds,
      detail: hasCreds
        ? `User ${c!.user} · stored locally only — never cloud-synced, never in backups.`
        : 'Enter your Rithmic user + password below. They are kept on this device only.',
    },
    {
      step: 'Environment & gateway chosen',
      done: hasGateway,
      detail: hasGateway
        ? `${c!.env.toUpperCase()} · ${c!.gatewayUrl}`
        : 'Pick Test / Paper / Production and set the wss:// gateway (Test is prefilled; others come from your dev kit or broker).',
    },
    {
      step: 'System name for the login handshake',
      done: hasSystem,
      detail: hasSystem
        ? `"${c!.systemName.trim() || RITHMIC_ENVS[0].defaultSystem}" — sent in the login request.`
        : 'Production logins require the system name Rithmic registers for your app after conformance. The Test environment uses "Rithmic Test".',
    },
    {
      step: 'R | Protocol dev kit (proto definitions)',
      done: false,
      detail:
        'Request API access at rithmic.com/api-request (or through your broker / prop firm — prop credentials must be API-enabled by the firm). The kit\'s .proto files complete the login → market-data → order-routing pipeline here.',
    },
  ];
}

/* ---------------------------- gateway reachability ------------------------ */

export interface ProbeResult {
  reachable: boolean;
  latencyMs: number;
  detail: string;
}

type WSLike = { close(): void; onopen: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null };
type WSCtor = new (url: string) => WSLike;

/**
 * Can this browser open a WebSocket to the gateway? A successful open proves
 * network + TLS + the Rithmic edge accepting browser connections — the whole
 * transport layer under the protobuf handshake. Injectable ctor for tests.
 */
export function probeGateway(url: string, WS: WSCtor = WebSocket as unknown as WSCtor, timeoutMs = 8000): Promise<ProbeResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    if (!/^wss:\/\//i.test(url)) {
      resolve({ reachable: false, latencyMs: 0, detail: 'Gateway must be a wss:// address.' });
      return;
    }
    let settled = false;
    const finish = (r: ProbeResult, ws?: WSLike) => {
      if (settled) return;
      settled = true;
      try {
        ws?.close();
      } catch {
        // already closed
      }
      resolve(r);
    };
    let ws: WSLike;
    try {
      ws = new WS(url);
    } catch {
      finish({ reachable: false, latencyMs: Date.now() - t0, detail: 'The browser refused to open the socket (bad address?).' });
      return;
    }
    const timer = setTimeout(() => finish({ reachable: false, latencyMs: Date.now() - t0, detail: 'Timed out — gateway unreachable from this network.' }, ws), timeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      finish({ reachable: true, latencyMs: Date.now() - t0, detail: 'WebSocket opened — the transport to this gateway works from your browser.' }, ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish({ reachable: false, latencyMs: Date.now() - t0, detail: 'Connection refused — wrong address, or this gateway does not accept connections from unregistered apps.' }, ws);
    };
  });
}
