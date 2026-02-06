import { useState, useEffect } from "react";

// ─── trudev.fun — "The Launchpad Devs Can't Rug" ─────────────────
// Mobile-first responsive design
// Terminal aesthetic + Bloomberg data density
// Emerald green (#10b981) on near-black (#08080c)

const mono = "'JetBrains Mono', monospace";
const sans = "'Space Grotesk', sans-serif";
const green = "#10b981";

const TOKENS = [
  {
    id: 1, name: "NeuralSwap", ticker: "$NSWAP", tier: 4, tierLabel: "SHIPPED", image: "🧠",
    dev: { github: "alexchen", avatar: "AC", accountAge: "3yr", repos: 47, commits: 2841, lastCommit: "2h ago", lastCommitMsg: "fix: swap routing edge case on low liq pairs" },
    repo: { name: "neuralswap-core", lang: "Rust", stars: 124, forks: 18, lastPush: "2h", commits30d: 67 },
    lock: { amount: "4.2M", duration: "180d", pct: 12, start: "Jan 15", end: "Jul 14" },
    mcap: "$482K", vol: "$89K", price: "$0.000482", chg: "+34.2%", holders: 1847, live: "neuralswap.io",
  },
  {
    id: 2, name: "SolForge", ticker: "$FORGE", tier: 3, tierLabel: "BUILDER", image: "⚒️",
    dev: { github: "rustdev99", avatar: "RD", accountAge: "5yr", repos: 82, commits: 6103, lastCommit: "6h ago", lastCommitMsg: "feat: add staking vault instructions" },
    repo: { name: "solforge-protocol", lang: "Rust", stars: 67, forks: 9, lastPush: "6h", commits30d: 41 },
    lock: { amount: "8.1M", duration: "90d", pct: 28, start: "Dec 20", end: "Mar 20" },
    mcap: "$1.2M", vol: "$203K", price: "$0.0012", chg: "+8.7%", holders: 3201,
  },
  {
    id: 3, name: "PixelVault", ticker: "$PXVT", tier: 2, tierLabel: "VERIFIED", image: "🎮",
    dev: { github: "gamedev_sarah", avatar: "GS", accountAge: "2yr", repos: 23, commits: 891, lastCommit: "1d ago", lastCommitMsg: "chore: update dependencies" },
    repo: { name: "pixelvault-game", lang: "TypeScript", stars: 34, forks: 5, lastPush: "1d", commits30d: 19 },
    lock: { amount: "2.5M", duration: "60d", pct: 45, start: "Dec 01", end: "Jan 30" },
    mcap: "$156K", vol: "$12K", price: "$0.000156", chg: "-2.1%", holders: 624,
  },
  {
    id: 4, name: "DataWeave", ticker: "$WEAVE", tier: 3, tierLabel: "BUILDER", image: "🕸️",
    dev: { github: "0xweaver", avatar: "0W", accountAge: "4yr", repos: 61, commits: 4217, lastCommit: "4h ago", lastCommitMsg: "feat: oracle price feed integration" },
    repo: { name: "dataweave-sdk", lang: "Rust", stars: 89, forks: 14, lastPush: "4h", commits30d: 53 },
    lock: { amount: "5.5M", duration: "120d", pct: 18, start: "Jan 05", end: "May 05" },
    mcap: "$890K", vol: "$145K", price: "$0.00089", chg: "+22.5%", holders: 2156,
  },
  {
    id: 5, name: "ZKBridge", ticker: "$ZKB", tier: 4, tierLabel: "SHIPPED", image: "🔐",
    dev: { github: "cryptomatt", avatar: "CM", accountAge: "6yr", repos: 94, commits: 8920, lastCommit: "30m ago", lastCommitMsg: "perf: optimize proof verification by 3x" },
    repo: { name: "zkbridge-protocol", lang: "Rust", stars: 312, forks: 45, lastPush: "30m", commits30d: 89 },
    lock: { amount: "12M", duration: "365d", pct: 5, start: "Jan 20", end: "Jan '27" },
    mcap: "$3.4M", vol: "$520K", price: "$0.0034", chg: "+67.1%", holders: 5892, live: "zkbridge.xyz",
  },
  {
    id: 6, name: "AetherAI", ticker: "$AETH", tier: 1, tierLabel: "LOCKED", image: "✨",
    dev: { github: null, avatar: "??", accountAge: null },
    lock: { amount: "1M", duration: "30d", pct: 60, start: "Jan 01", end: "Jan 31" },
    mcap: "$45K", vol: "$3K", price: "$0.000045", chg: "-12.3%", holders: 189,
  },
];

const COMMITS = [
  { dev: "cryptomatt", ticker: "$ZKB", msg: "perf: optimize proof verification", time: "30m" },
  { dev: "alexchen", ticker: "$NSWAP", msg: "fix: swap routing edge case", time: "2h" },
  { dev: "0xweaver", ticker: "$WEAVE", msg: "feat: oracle price feed", time: "4h" },
  { dev: "rustdev99", ticker: "$FORGE", msg: "feat: staking vault ix", time: "6h" },
];

// ─── Shared UI ────────────────────────────────────────────────────

function Badge({ tier, label }) {
  const c = { 1: ["rgba(100,100,100,0.2)","#555","#999"], 2: ["rgba(59,130,246,0.12)","#3b82f6","#60a5fa"], 3: ["rgba(168,85,247,0.12)","#a855f7","#c084fc"], 4: ["rgba(16,185,129,0.12)","#10b981","#34d399"] }[tier];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"2px 7px", borderRadius:4, fontSize:9, fontWeight:700, fontFamily:mono, letterSpacing:"0.05em", background:c[0], border:`1px solid ${c[1]}`, color:c[2], whiteSpace:"nowrap" }}>
      {tier >= 2 && <span style={{ width:4, height:4, borderRadius:"50%", background:c[2] }} />}{label}
    </span>
  );
}

function Bar({ pct }) {
  return (
    <div style={{ width:"100%", height:3, background:"rgba(255,255,255,0.06)", borderRadius:2, overflow:"hidden" }}>
      <div style={{ width:`${pct}%`, height:"100%", borderRadius:2, background: pct < 33 ? green : pct < 66 ? "#f59e0b" : "#ef4444" }} />
    </div>
  );
}

function Graph() {
  return (
    <div style={{ display:"flex", gap:2, overflow:"hidden" }}>
      {Array.from({ length:16 }).map((_,w) => (
        <div key={w} style={{ display:"flex", flexDirection:"column", gap:2 }}>
          {Array.from({ length:7 }).map((_,d) => {
            const i = Math.random();
            return <div key={d} style={{ width:6, height:6, borderRadius:1, background: i > 0.7 ? green : i > 0.4 ? "#065f46" : i > 0.15 ? "#064e3b" : "rgba(255,255,255,0.03)" }} />;
          })}
        </div>
      ))}
    </div>
  );
}

function Logo({ onClick }) {
  return (
    <div onClick={onClick} style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer" }}>
      {/* Mini shield icon */}
      <div style={{ width:26, height:26, borderRadius:6, background:`linear-gradient(135deg, ${green}, #059669)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:900, color:"#000", fontFamily:mono }}>
        {"✓"}
      </div>
      <span style={{ fontSize:15, fontFamily:sans, fontWeight:700, color:"#fff" }}>
        tru<span style={{ color:green }}>dev</span><span style={{ color:"#555" }}>.fun</span>
      </span>
    </div>
  );
}

function Nav({ page, onNav }) {
  return (
    <nav className="nav-bar">
      <Logo onClick={() => onNav("landing")} />
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        {["feed","launch"].map(p => (
          <button key={p} onClick={() => onNav(p === "feed" ? "feed" : "launch")} className="nav-link" style={{ color: page === p ? green : "#555" }}>{p === "feed" ? "explore" : "launch"}</button>
        ))}
        <button className="nav-connect">connect</button>
      </div>
    </nav>
  );
}

// ─── Landing ──────────────────────────────────────────────────────

function Landing({ onNav }) {
  const [typed, setTyped] = useState("");
  const full = "trudev verify --lock --ship";
  const [cur, setCur] = useState(true);

  useEffect(() => {
    let i = 0;
    const iv = setInterval(() => { if (i <= full.length) { setTyped(full.slice(0, i)); i++; } else clearInterval(iv); }, 50);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { const iv = setInterval(() => setCur(v => !v), 530); return () => clearInterval(iv); }, []);

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      <Nav page="landing" onNav={onNav} />
      <div className="hero-wrap">
        {/* Dot grid bg */}
        <div className="dot-grid" />
        <div className="hero-glow" />

        <div style={{ position:"relative", textAlign:"center", maxWidth:680, width:"100%", padding:"0 20px" }}>
          {/* Terminal prompt */}
          <div className="terminal-line">
            <span style={{ color:"#555" }}>$ </span>{typed}<span style={{ opacity: cur ? 1 : 0, color:green }}>▊</span>
          </div>

          <h1 className="hero-h1">
            Launch Tokens<br />
            <span style={{ color:green }}>Devs Can't Rug</span>
          </h1>

          <p className="hero-sub">
            Verified developers. Locked bags. On-chain proof.
            <br />Built on pump.fun + Streamflow.
          </p>

          <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
            <button onClick={() => onNav("launch")} className="btn-primary">launch token →</button>
            <button onClick={() => onNav("feed")} className="btn-secondary">explore builders</button>
          </div>

          {/* Trust signals */}
          <div className="trust-row">
            {["🔒 Streamflow Vesting","⚡ Pump.fun Liquidity","✓ GitHub Verified","📊 DexScreener Ready"].map((s,i) => (
              <span key={i} className="trust-pill">{s}</span>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          {[{ l:"launched", v:"847" },{ l:"total locked", v:"$4.2M" },{ l:"devs verified", v:"312" },{ l:"building now", v:"89" }].map((s,i) => (
            <div key={i} style={{ textAlign:"center" }}>
              <div className="stat-val">{s.v}</div>
              <div className="stat-label">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Feed ─────────────────────────────────────────────────────────

function Feed({ onNav, onSelect }) {
  const [filter, setFilter] = useState("all");
  const [ci, setCi] = useState(0);
  useEffect(() => { const iv = setInterval(() => setCi(i => (i+1)%COMMITS.length), 3000); return () => clearInterval(iv); }, []);

  const list = TOKENS.filter(t => filter === "builders" ? t.tier >= 3 : filter === "shipped" ? t.tier >= 4 : true);
  const c = COMMITS[ci];

  return (
    <div style={{ minHeight:"100vh" }}>
      <Nav page="feed" onNav={onNav} />
      <div className="page-container">
        {/* Live ticker */}
        <div className="live-ticker">
          <span className="pulse-dot" />
          <span style={{ color:green, flexShrink:0 }}>@{c.dev}</span>
          <span style={{ color:"#444", flexShrink:0 }}>→</span>
          <span style={{ color:"#fff", fontWeight:600, flexShrink:0 }}>{c.ticker}</span>
          <span className="ticker-msg">{c.msg}</span>
          <span style={{ color:"#444", flexShrink:0 }}>{c.time}</span>
        </div>

        {/* Header */}
        <div className="feed-header">
          <h2 className="feed-title">Active Builders</h2>
          <div style={{ display:"flex", gap:4 }}>
            {["all","builders","shipped"].map(f => (
              <button key={f} onClick={() => setFilter(f)} className="filter-btn" style={{
                borderColor: filter===f ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)",
                background: filter===f ? "rgba(16,185,129,0.08)" : "transparent",
                color: filter===f ? green : "#555",
              }}>{f}</button>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div className="token-list">
          {list.map(t => (
            <div key={t.id} onClick={() => onSelect(t)} className="token-card">
              {/* Row 1: Avatar + Name + Price */}
              <div className="card-top">
                <div className="card-icon">{t.image}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap" }}>
                    <span className="card-name">{t.name}</span>
                    <span className="card-ticker">{t.ticker}</span>
                    <Badge tier={t.tier} label={t.tierLabel} />
                  </div>
                  <div className="card-dev">
                    {t.dev.github ? `@${t.dev.github} · ${t.dev.accountAge}` : "anon dev"}
                  </div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div className="card-mcap">{t.mcap}</div>
                  <div className="card-chg" style={{ color: t.chg.startsWith("+") ? green : "#ef4444" }}>{t.chg}</div>
                </div>
              </div>
              {/* Row 2: Lock + GitHub */}
              <div className="card-bottom">
                <div className="card-lock">
                  <span style={{ marginRight:6 }}>🔒 {t.lock.amount} · {t.lock.duration}</span>
                  <div style={{ flex:1, minWidth:40 }}><Bar pct={t.lock.pct} /></div>
                  <span style={{ color:"#555", marginLeft:6 }}>{100 - t.lock.pct}%</span>
                </div>
                {t.repo && (
                  <div className="card-repo">
                    ⭐{t.repo.stars} · {t.repo.commits30d} commits/30d · pushed {t.repo.lastPush} ago
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Token Detail ─────────────────────────────────────────────────

function Detail({ token: t, onNav }) {
  if (!t) return null;
  return (
    <div style={{ minHeight:"100vh" }}>
      <Nav page="" onNav={onNav} />
      <div className="page-container">
        {/* Back */}
        <button onClick={() => onNav("feed")} className="back-btn">← back to feed</button>

        {/* Header */}
        <div className="detail-header">
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div className="detail-icon">{t.image}</div>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <h1 className="detail-name">{t.name}</h1>
                <span className="detail-ticker">{t.ticker}</span>
                <Badge tier={t.tier} label={t.tierLabel} />
              </div>
              {t.dev.github && (
                <div className="detail-dev">
                  <span style={{ color:green }}>@{t.dev.github}</span> · {t.dev.accountAge} on GitHub · {t.dev.repos} repos
                </div>
              )}
            </div>
          </div>
          <div style={{ textAlign:"right", marginTop:8 }}>
            <div className="detail-price">{t.price}</div>
            <div className="detail-chg" style={{ color: t.chg.startsWith("+") ? green : "#ef4444" }}>{t.chg} 24h</div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="stats-strip">
          {[
            { l:"MCap", v:t.mcap }, { l:"Volume", v:t.vol }, { l:"Holders", v:t.holders?.toLocaleString() },
            { l:"Locked", v:t.lock.amount }, { l:"Duration", v:t.lock.duration },
          ].map((s,i) => (
            <div key={i} className="strip-item">
              <div className="strip-label">{s.l}</div>
              <div className="strip-val">{s.v}</div>
            </div>
          ))}
        </div>

        <div className="detail-grid">
          {/* Lock Card */}
          <div className="card-section lock-card">
            <div className="section-head">
              <span>🔒 Vesting Lock — Streamflow</span>
              <span className="section-link">verify →</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#666", fontFamily:mono, marginBottom:6 }}>
              <span>{t.lock.start}</span><span>{t.lock.end}</span>
            </div>
            <div style={{ width:"100%", height:8, background:"rgba(255,255,255,0.04)", borderRadius:4, overflow:"hidden", position:"relative", marginBottom:12 }}>
              <div style={{ width:`${t.lock.pct}%`, height:"100%", borderRadius:4, background:`linear-gradient(90deg, ${green}, #059669)` }} />
              <div style={{ position:"absolute", left:`${t.lock.pct}%`, top:-3, width:2, height:14, background:green, boxShadow:`0 0 8px rgba(16,185,129,0.5)` }} />
            </div>
            <div style={{ textAlign:"center", marginBottom:16 }}>
              <span style={{ fontFamily:mono, fontSize:22, fontWeight:700, color:"#fff" }}>{100-t.lock.pct}%</span>
              <span style={{ fontFamily:mono, fontSize:12, color:"#555", marginLeft:6 }}>still locked</span>
            </div>
            <div className="mini-stats">
              <div className="mini-stat"><div className="mini-label">Tokens</div><div className="mini-val">{t.lock.amount}</div></div>
              <div className="mini-stat"><div className="mini-label">Duration</div><div className="mini-val">{t.lock.duration}</div></div>
            </div>
          </div>

          {/* Dev Profile */}
          {t.dev.github && (
            <div className="card-section">
              <div className="section-head"><span>Developer Profile</span></div>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
                <div className="dev-avatar">{t.dev.avatar}</div>
                <div>
                  <div style={{ fontFamily:mono, fontSize:14, fontWeight:700, color:"#fff" }}>@{t.dev.github}</div>
                  <div style={{ fontFamily:mono, fontSize:10, color:"#555" }}>{t.dev.repos} repos · {t.dev.commits?.toLocaleString()} commits · {t.dev.accountAge}</div>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <div className="mini-label" style={{ marginBottom:6 }}>commit activity (16 weeks)</div>
                <Graph />
              </div>
              <div className="commit-line">
                <span style={{ color:"#555" }}>latest → </span>
                <span style={{ color:green }}>{t.dev.lastCommit}</span>
                <div style={{ color:"#777", marginTop:4, fontSize:11 }}>"{t.dev.lastCommitMsg}"</div>
              </div>
            </div>
          )}

          {/* Repo */}
          {t.repo && (
            <div className="card-section">
              <div className="section-head"><span>Linked Repository</span></div>
              <div className="repo-box">
                <div style={{ fontFamily:mono, fontSize:13, fontWeight:700, color:"#fff" }}>📁 {t.dev.github}/{t.repo.name}</div>
                <div style={{ fontFamily:mono, fontSize:10, color:"#555", marginTop:4 }}>{t.repo.lang} · ⭐{t.repo.stars} · 🍴{t.repo.forks}</div>
              </div>
              <div className="mini-stats" style={{ marginTop:12 }}>
                <div className="mini-stat"><div className="mini-label">30d commits</div><div className="mini-val">{t.repo.commits30d}</div></div>
                <div className="mini-stat"><div className="mini-label">Last push</div><div className="mini-val">{t.repo.lastPush} ago</div></div>
              </div>
              {/* Recent commits */}
              <div style={{ marginTop:14 }}>
                <div className="mini-label" style={{ marginBottom:6 }}>recent commits</div>
                {[
                  { h:"a3f8e2d", m:t.dev.lastCommitMsg, t:t.dev.lastCommit },
                  { h:"7b2c1f0", m:"refactor: clean up account validation", t:"1d ago" },
                  { h:"e91d4a8", m:"test: add integration tests for swap", t:"2d ago" },
                ].map((c,i) => (
                  <div key={i} className="commit-row">
                    <span style={{ color:"#f59e0b", flexShrink:0 }}>{c.h}</span>
                    <span className="commit-msg">{c.m}</span>
                    <span style={{ color:"#333", flexShrink:0 }}>{c.t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live URL */}
          {t.live && (
            <div className="card-section live-card">
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontFamily:mono, fontSize:10, color:green, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:3 }}>✅ Live Product Verified</div>
                  <div style={{ fontFamily:mono, fontSize:13, color:"#fff" }}>{t.live}</div>
                </div>
                <span style={{ width:8, height:8, borderRadius:"50%", background:green, boxShadow:`0 0 12px rgba(16,185,129,0.5)` }} />
              </div>
            </div>
          )}

          {/* Buy CTA */}
          <div className="card-section cta-card">
            <div style={{ fontFamily:mono, fontSize:9, color:"#666", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10, textAlign:"center" }}>
              liquidity powered by pump.fun
            </div>
            <button className="btn-primary" style={{ width:"100%", padding:"14px 0" }}>
              Buy {t.ticker} on Pump.fun →
            </button>
            <div style={{ fontFamily:mono, fontSize:10, color:"#444", textAlign:"center", marginTop:8 }}>
              {t.holders?.toLocaleString()} holders · {t.vol} 24h vol
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Launch Wizard ────────────────────────────────────────────────

function Launch({ onNav }) {
  const [step, setStep] = useState(1);
  const [gh, setGh] = useState(false);
  const [lockDays, setLockDays] = useState(90);
  const [lockPct, setLockPct] = useState(100);
  const [dexPrepay, setDexPrepay] = useState(false);

  const inputStyle = {
    width:"100%", padding:"11px 14px", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)",
    background:"rgba(255,255,255,0.03)", color:"#fff", fontFamily:mono, fontSize:13,
    outline:"none", boxSizing:"border-box",
  };

  return (
    <div style={{ minHeight:"100vh" }}>
      <Nav page="launch" onNav={onNav} />
      <div className="page-container" style={{ maxWidth:600 }}>
        <h2 className="wizard-title">Launch a Token</h2>
        <p className="wizard-sub">Create on pump.fun · Lock with Streamflow · Verify with GitHub</p>

        {/* Progress */}
        <div style={{ display:"flex", gap:3, marginBottom:32 }}>
          {[1,2,3,4].map(s => (
            <div key={s} style={{ flex:1, height:3, borderRadius:2, background: s <= step ? green : "rgba(255,255,255,0.06)", transition:"background 0.3s" }} />
          ))}
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div>
            <div className="step-label">01 — Token Details</div>
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <div className="upload-box"><span style={{ fontSize:24 }}>+</span><span style={{ fontSize:10, color:"#555" }}>image</span></div>
              <div className="form-row">
                <div style={{ flex:2 }}>
                  <label className="field-label">Name</label>
                  <input placeholder="e.g. NeuralSwap" style={inputStyle} />
                </div>
                <div style={{ flex:1 }}>
                  <label className="field-label">Ticker</label>
                  <input placeholder="$NSWAP" style={inputStyle} />
                </div>
              </div>
              <div>
                <label className="field-label">Description</label>
                <textarea placeholder="What are you building?" rows={3} style={{ ...inputStyle, resize:"vertical" }} />
              </div>
              <div className="form-row">
                <div style={{ flex:1 }}><label className="field-label">Twitter</label><input placeholder="@handle" style={inputStyle} /></div>
                <div style={{ flex:1 }}><label className="field-label">Website</label><input placeholder="https://" style={inputStyle} /></div>
              </div>
            </div>
            <button onClick={() => setStep(2)} className="btn-primary" style={{ width:"100%", marginTop:24 }}>continue →</button>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div>
            <div className="step-label">02 — Lock Configuration</div>
            <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
              <div>
                <label className="field-label">Initial Buy (SOL)</label>
                <input defaultValue="2.0" style={inputStyle} />
                <div className="field-hint">This SOL buys your initial supply, which gets locked</div>
              </div>
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <label className="field-label" style={{ margin:0 }}>Lock Duration</label>
                  <span style={{ fontFamily:mono, fontSize:14, color:green, fontWeight:700 }}>{lockDays} days</span>
                </div>
                <input type="range" min={7} max={365} value={lockDays} onChange={e => setLockDays(+e.target.value)} style={{ width:"100%", accentColor:green }} />
                <div className="range-labels"><span>7d</span><span>365d</span></div>
              </div>
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <label className="field-label" style={{ margin:0 }}>Tokens to Lock</label>
                  <span style={{ fontFamily:mono, fontSize:14, color:green, fontWeight:700 }}>{lockPct}%</span>
                </div>
                <input type="range" min={50} max={100} value={lockPct} onChange={e => setLockPct(+e.target.value)} style={{ width:"100%", accentColor:green }} />
                <div className="range-labels"><span>50%</span><span>100%</span></div>
              </div>
              {/* DexScreener prepay */}
              <div className="dex-option" onClick={() => setDexPrepay(!dexPrepay)} style={{ borderColor: dexPrepay ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)", background: dexPrepay ? "rgba(16,185,129,0.04)" : "rgba(255,255,255,0.015)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div className="checkbox" style={{ background: dexPrepay ? green : "transparent", borderColor: dexPrepay ? green : "#555" }}>
                    {dexPrepay && <span style={{ color:"#000", fontSize:10, fontWeight:900 }}>✓</span>}
                  </div>
                  <div>
                    <div style={{ fontFamily:mono, fontSize:12, color:"#fff", fontWeight:600 }}>📊 DexScreener Bond ($299)</div>
                    <div style={{ fontFamily:mono, fontSize:10, color:"#666", marginTop:2 }}>Escrowed until you complete DexScreener setup. Auto-verified via API, refunded on completion.</div>
                  </div>
                </div>
              </div>
              {/* Preview */}
              <div className="lock-preview">
                <div style={{ fontFamily:mono, fontSize:10, color:green, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>Lock Preview</div>
                <div style={{ fontFamily:mono, fontSize:12, color:"#fff" }}>🔒 {lockPct}% locked for {lockDays} days via Streamflow</div>
                <div style={{ fontFamily:mono, fontSize:10, color:"#555", marginTop:3 }}>Linear unlock · Non-cancelable · On-chain</div>
              </div>
            </div>
            <div className="btn-row">
              <button onClick={() => setStep(1)} className="btn-secondary" style={{ flex:1 }}>← back</button>
              <button onClick={() => setStep(3)} className="btn-primary" style={{ flex:2 }}>continue →</button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div>
            <div className="step-label">03 — Verify Identity</div>
            <p className="wizard-hint">Optional but recommended. Verified tokens get higher trust tiers and visibility.</p>
            {!gh ? (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <button onClick={() => setGh(true)} className="github-btn">⬡ Connect GitHub</button>
                <button onClick={() => setStep(4)} className="skip-btn">skip — token will be Tier 1 (Locked only)</button>
              </div>
            ) : (
              <div>
                <div className="gh-connected">
                  <span style={{ width:8, height:8, borderRadius:"50%", background:green }} />
                  <span style={{ color:green, flex:1 }}>✓ Connected as @dylan_dev</span>
                  <span style={{ color:"#555", fontSize:10 }}>47 repos · 2.8k commits</span>
                </div>
                <div style={{ marginTop:16 }}>
                  <label className="field-label">Link a Repo (optional)</label>
                  <select style={{ ...inputStyle, appearance:"none" }}>
                    <option>Select a repository...</option>
                    <option>dylan_dev/neuralswap-core (Rust · 124⭐)</option>
                    <option>dylan_dev/trading-bot (TS · 45⭐)</option>
                  </select>
                </div>
                <div style={{ marginTop:12 }}>
                  <label className="field-label">Live URL (optional)</label>
                  <input placeholder="https://your-app.com" style={inputStyle} />
                </div>
                <div className="btn-row">
                  <button onClick={() => setStep(2)} className="btn-secondary" style={{ flex:1 }}>← back</button>
                  <button onClick={() => setStep(4)} className="btn-primary" style={{ flex:2 }}>continue →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <div>
            <div className="step-label">04 — Review & Launch</div>
            <div className="review-box">
              <div className="mini-label" style={{ marginBottom:12 }}>Transaction Preview</div>
              {[
                { n:"1", l:"Create token on pump.fun", d:"name, ticker, metadata" },
                { n:"2", l:"Buy initial supply", d:"2.0 SOL → ~4.2M tokens" },
                { n:"3", l:"Lock via Streamflow", d:`${lockPct}% locked for ${lockDays} days` },
                ...(dexPrepay ? [{ n:"4", l:"DexScreener bond (escrow)", d:"~$299 SOL, refunded on verification" }] : []),
              ].map((t,i) => (
                <div key={i} className="review-step">
                  <span className="review-num">{t.n}</span>
                  <div><div className="review-main">{t.l}</div><div className="review-detail">{t.d}</div></div>
                </div>
              ))}
            </div>
            <div className="warning-box">⚠ One signature. All actions atomic — if any fails, all revert.</div>
            <div className="cost-row">
              <span>estimated cost</span>
              <span style={{ color:"#fff", fontWeight:700 }}>
                {dexPrepay ? "~4.2 SOL" : "~2.07 SOL"}
                <span style={{ color:"#555", fontWeight:400, fontSize:10, marginLeft:4 }}>(buy + fees{dexPrepay ? " + dex bond" : ""})</span>
              </span>
            </div>
            <div className="btn-row">
              <button onClick={() => setStep(3)} className="btn-secondary" style={{ flex:1 }}>← back</button>
              <button className="btn-launch" style={{ flex:2 }}>🚀 LAUNCH TOKEN</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────

export default function TruDev() {
  const [page, setPage] = useState("landing");
  const [token, setToken] = useState(null);

  return (
    <div style={{ background:"#08080c", color:"#fff", minHeight:"100vh", fontFamily:sans }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        ::selection{background:rgba(16,185,129,0.3);color:#fff}
        input::placeholder,textarea::placeholder{color:#444}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}

        .nav-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.06);position:sticky;top:0;background:rgba(8,8,12,0.92);backdrop-filter:blur(12px);z-index:100}
        .nav-link{background:none;border:none;font-family:${mono};font-size:11px;cursor:pointer;padding:4px 0}
        .nav-connect{background:#10b981;border:none;color:#000;padding:6px 12px;border-radius:6px;font-family:${mono};font-size:10px;font-weight:700;cursor:pointer}

        .hero-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 16px;position:relative;text-align:center;min-height:calc(100vh - 49px)}
        .dot-grid{position:absolute;inset:0;opacity:0.04;background-image:radial-gradient(circle,rgba(16,185,129,1) 1px,transparent 1px);background-size:20px 20px;pointer-events:none}
        .hero-glow{position:absolute;top:10%;left:50%;transform:translateX(-50%);width:min(500px,100vw);height:min(500px,100vw);border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.07) 0%,transparent 70%);pointer-events:none}
        .terminal-line{display:inline-block;padding:6px 14px;margin-bottom:20px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:6px;font-family:${mono};font-size:clamp(11px,2.5vw,14px);color:#10b981;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .hero-h1{font-family:${sans};font-size:clamp(32px,8vw,60px);font-weight:800;color:#fff;line-height:1.05;margin:0 0 14px;letter-spacing:-0.03em}
        .hero-sub{font-family:${mono};font-size:clamp(11px,2.3vw,14px);color:#777;line-height:1.7;margin:0 auto 28px;max-width:440px}
        .trust-row{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:32px}
        .trust-pill{font-family:${mono};font-size:10px;color:#555;padding:4px 10px;border:1px solid rgba(255,255,255,0.06);border-radius:20px;white-space:nowrap}
        .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;width:100%;max-width:440px;margin-top:36px;padding:0 8px}
        .stat-val{font-size:clamp(16px,4vw,22px);color:#fff;font-weight:700;font-family:${mono}}
        .stat-label{font-size:9px;color:#555;text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;font-family:${mono}}

        .btn-primary{background:#10b981;border:none;color:#000;padding:12px 24px;border-radius:8px;font-family:${mono};font-size:13px;font-weight:700;cursor:pointer}
        .btn-secondary{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#ccc;padding:12px 24px;border-radius:8px;font-family:${mono};font-size:13px;font-weight:600;cursor:pointer}
        .btn-launch{padding:16px 0;border-radius:8px;border:none;background:linear-gradient(135deg,#10b981,#059669);color:#000;font-family:${mono};font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 0 30px rgba(16,185,129,0.2)}
        .btn-row{display:flex;gap:10px;margin-top:24px}

        .page-container{max-width:1100px;margin:0 auto;padding:16px}
        .live-ticker{display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:14px;background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.1);border-radius:8px;font-family:${mono};font-size:11px;overflow:hidden}
        .pulse-dot{width:5px;height:5px;border-radius:50%;background:#10b981;flex-shrink:0;box-shadow:0 0 8px rgba(16,185,129,0.5);animation:pulse 2s infinite}
        .ticker-msg{color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}

        .feed-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px}
        .feed-title{font-family:${sans};font-size:20px;font-weight:700;color:#fff}
        .filter-btn{padding:4px 10px;border-radius:5px;border:1px solid;font-family:${mono};font-size:10px;font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:0.05em}

        .token-list{display:flex;flex-direction:column;gap:6px}
        .token-card{padding:12px 14px;background:rgba(255,255,255,0.015);border-radius:10px;cursor:pointer;border:1px solid rgba(255,255,255,0.04);transition:border-color 0.15s}
        .token-card:active{border-color:rgba(16,185,129,0.2)}
        .card-top{display:flex;align-items:center;gap:10px;margin-bottom:8px}
        .card-icon{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04);font-size:16px;border:1px solid rgba(255,255,255,0.06);flex-shrink:0}
        .card-name{font-family:${sans};font-size:14px;font-weight:700;color:#fff}
        .card-ticker{font-family:${mono};font-size:11px;color:#555}
        .card-dev{font-family:${mono};font-size:10px;color:#444;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .card-mcap{font-family:${mono};font-size:13px;color:#e5e5e5;font-weight:700}
        .card-chg{font-family:${mono};font-size:11px;font-weight:600}
        .card-bottom{display:flex;flex-direction:column;gap:4px}
        .card-lock{display:flex;align-items:center;font-family:${mono};font-size:10px;color:#888}
        .card-repo{font-family:${mono};font-size:10px;color:#444}

        .back-btn{background:none;border:none;color:#555;font-family:${mono};font-size:12px;cursor:pointer;padding:0;margin-bottom:16px}
        .detail-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px}
        .detail-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04);font-size:24px;border:1px solid rgba(255,255,255,0.08);flex-shrink:0}
        .detail-name{font-family:${sans};font-size:clamp(20px,5vw,28px);font-weight:800;color:#fff;margin:0}
        .detail-ticker{font-family:${mono};font-size:13px;color:#555}
        .detail-dev{font-family:${mono};font-size:11px;color:#666;margin-top:3px}
        .detail-price{font-family:${mono};font-size:clamp(18px,4vw,24px);font-weight:700;color:#fff}
        .detail-chg{font-family:${mono};font-size:12px;font-weight:600;margin-top:2px}

        .stats-strip{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:rgba(255,255,255,0.04);border-radius:10px;overflow:hidden;margin-bottom:20px;border:1px solid rgba(255,255,255,0.06)}
        .strip-item{padding:12px 10px;background:rgba(8,8,12,0.8)}
        .strip-label{font-family:${mono};font-size:9px;color:#444;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px}
        .strip-val{font-family:${mono};font-size:clamp(12px,2.5vw,15px);color:#fff;font-weight:700}
        @media(max-width:640px){.stats-strip{grid-template-columns:repeat(3,1fr)}.stats-strip .strip-item:nth-child(n+4){border-top:1px solid rgba(255,255,255,0.04)}}

        .detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media(max-width:768px){.detail-grid{grid-template-columns:1fr}}

        .card-section{padding:20px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.015)}
        .lock-card{border-color:rgba(16,185,129,0.15);background:rgba(16,185,129,0.03)}
        .live-card{border-color:rgba(16,185,129,0.15);background:rgba(16,185,129,0.03)}
        .cta-card{background:linear-gradient(135deg,rgba(16,185,129,0.04),rgba(16,185,129,0.01));border-color:rgba(255,255,255,0.08)}
        .section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;font-family:${mono};font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.08em}
        .section-link{font-weight:400;color:#555;font-size:10px;text-transform:none;letter-spacing:0}

        .mini-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .mini-stat{padding:8px 12px;background:rgba(0,0,0,0.3);border-radius:8px}
        .mini-label{font-family:${mono};font-size:9px;color:#555;text-transform:uppercase;letter-spacing:0.08em}
        .mini-val{font-family:${mono};font-size:14px;color:#e5e5e5;font-weight:600;margin-top:2px}

        .dev-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(16,185,129,0.1);border:2px solid rgba(16,185,129,0.3);font-family:${mono};font-size:13px;font-weight:700;color:#10b981;flex-shrink:0}
        .commit-line{padding:10px 12px;background:rgba(0,0,0,0.3);border-radius:8px;font-family:${mono};font-size:12px}
        .repo-box{padding:14px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.3)}
        .commit-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.03);font-family:${mono};font-size:10px}
        .commit-row:last-child{border-bottom:none}
        .commit-msg{color:#888;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

        .wizard-title{font-family:${sans};font-size:clamp(24px,6vw,32px);font-weight:800;color:#fff;margin-bottom:4px}
        .wizard-sub{font-family:${mono};font-size:12px;color:#555;margin-bottom:28px}
        .wizard-hint{font-family:${mono};font-size:11px;color:#555;margin-bottom:20px}
        .step-label{font-family:${mono};font-size:13px;color:#10b981;font-weight:700;margin-bottom:20px}
        .field-label{font-family:${mono};font-size:10px;color:#555;text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:5px}
        .field-hint{font-family:${mono};font-size:10px;color:#444;margin-top:4px}
        .form-row{display:flex;gap:10px}
        @media(max-width:480px){.form-row{flex-direction:column}}
        .range-labels{display:flex;justify-content:space-between;font-family:${mono};font-size:9px;color:#333;margin-top:3px}

        .upload-box{width:90px;height:90px;border-radius:14px;border:2px dashed rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:pointer;background:rgba(255,255,255,0.02);color:#555}

        .dex-option{padding:14px;border-radius:10px;border:1px solid;cursor:pointer;transition:all 0.15s}
        .checkbox{width:18px;height:18px;border-radius:4px;border:2px solid;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s}

        .lock-preview{padding:14px;border-radius:8px;background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.1)}

        .github-btn{width:100%;padding:14px 0;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#fff;font-family:${mono};font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px}
        .skip-btn{background:none;border:none;color:#444;font-family:${mono};font-size:11px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-align:center;width:100%}
        .gh-connected{padding:12px;border-radius:8px;border:1px solid rgba(16,185,129,0.2);background:rgba(16,185,129,0.04);display:flex;align-items:center;gap:10px;font-family:${mono};font-size:12px}

        .review-box{padding:18px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);margin-bottom:16px}
        .review-step{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)}
        .review-step:last-child{border-bottom:none}
        .review-num{width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);font-family:${mono};font-size:11px;font-weight:700;color:#10b981;flex-shrink:0}
        .review-main{font-family:${mono};font-size:12px;color:#fff;font-weight:600}
        .review-detail{font-family:${mono};font-size:10px;color:#555;margin-top:2px}
        .warning-box{padding:12px 14px;border-radius:8px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);margin-bottom:14px;font-family:${mono};font-size:11px;color:#f59e0b}
        .cost-row{padding:12px 14px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);margin-bottom:4px;display:flex;justify-content:space-between;font-family:${mono};font-size:12px;color:#555}
      `}</style>

      {page === "landing" && <Landing onNav={setPage} />}
      {page === "feed" && <Feed onNav={setPage} onSelect={t => { setToken(t); setPage("detail"); }} />}
      {page === "detail" && <Detail token={token} onNav={setPage} />}
      {page === "launch" && <Launch onNav={setPage} />}
    </div>
  );
}
