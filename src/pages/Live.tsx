import TradeDesk from './TradeDesk';

/**
 * Live cockpit — the "During trade" block.
 *
 * Law 1 governs this screen absolutely: quiet enough to read a price ladder
 * next to it. Levels, tape, ladders and the plan; nothing decorative.
 */
export default function Live() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="tile-label" style={{ marginBottom: 2 }}>During trade</div>
          <h1 className="page-title">Live</h1>
          <p className="page-sub">Levels, tape and ladders — capture what you see as you see it.</p>
        </div>
      </div>
      <div className="embedded"><TradeDesk /></div>
    </>
  );
}
