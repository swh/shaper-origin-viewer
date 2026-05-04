import { useEffect, useState } from "react";
import { BITS, CUSTOM_BIT_ID, bitById } from "../depth";
import { EXAMPLES } from "../examples";
import { useStore } from "../store";
import { SPECIES } from "../viewer/species";

export function Sidebar() {
  const {
    svgName,
    boardWidthMm,
    boardHeightMm,
    boardThicknessMm,
    bitId,
    customDiameterMm,
    speciesId,
    doc,
    renderMode,
    debugCutVolumes,
    loadSvg,
    setBoardWidth,
    setBoardHeight,
    setBoardThickness,
    setBitId,
    setCustomDiameter,
    setSpecies,
    setRenderMode,
    setDebugCutVolumes,
  } = useStore();
  const selectedBit = bitId === CUSTOM_BIT_ID ? null : bitById(bitId);
  const isCustom = bitId === CUSTOM_BIT_ID;
  const activeDiameter = isCustom ? customDiameterMm : (selectedBit?.diameterMm ?? 0);
  const activeProfile = isCustom ? "flat" : (selectedBit?.profile ?? "flat");
  const metricBits = BITS.filter((b) => b.group === "metric");
  const imperialBits = BITS.filter((b) => b.group === "imperial");

  const cutCount = doc?.cuts.length ?? 0;

  return (
    <aside className="w-80 shrink-0 border-r border-neutral-800 bg-neutral-950 text-neutral-200 overflow-y-auto">
      <div className="p-5 space-y-5">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Shaper Viewer</h1>
          <p className="text-xs text-neutral-500 mt-0.5">3D preview of Shaper Origin SVG cuts</p>
        </div>

        <Section label="Example design">
          <select
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-sm"
            value={svgName ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              const ex = EXAMPLES.find((x) => x.id === id);
              if (ex) loadSvg(ex.text, ex.id);
            }}
          >
            <option value="">— select —</option>
            {EXAMPLES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          {doc && (
            <p className="text-xs text-neutral-500 mt-2">
              {doc.widthMm.toFixed(1)} × {doc.heightMm.toFixed(1)} mm — {cutCount} cut
              {cutCount === 1 ? "" : "s"}
            </p>
          )}
        </Section>

        <Section label="Board">
          <NumberRow label="Width" value={boardWidthMm} onChange={setBoardWidth} unit="mm" />
          <NumberRow label="Length" value={boardHeightMm} onChange={setBoardHeight} unit="mm" />
          <NumberRow
            label="Thickness"
            value={boardThicknessMm}
            onChange={setBoardThickness}
            unit="mm"
          />
        </Section>

        <Section label="Wood">
          <div className="grid grid-cols-5 gap-1.5">
            {SPECIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSpecies(s.id)}
                className={`aspect-square rounded border transition ${
                  s.id === speciesId
                    ? "border-amber-400 ring-1 ring-amber-400"
                    : "border-neutral-800 hover:border-neutral-600"
                }`}
                style={{ backgroundColor: s.color }}
                title={s.label}
              />
            ))}
          </div>
        </Section>

        <Section label="Tool">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">Bit</span>
            <select
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-sm"
              value={bitId}
              onChange={(e) => setBitId(e.target.value)}
            >
              <optgroup label="Metric">
                {metricBits.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Imperial">
                {imperialBits.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Other">
                <option value={CUSTOM_BIT_ID}>Custom diameter…</option>
              </optgroup>
            </select>
          </label>

          {isCustom ? (
            <NumberRow
              label="Diameter"
              value={customDiameterMm}
              onChange={setCustomDiameter}
              unit="mm"
              step={0.1}
            />
          ) : (
            <div className="flex items-center justify-between text-xs text-neutral-500 px-0.5">
              <span>Profile: {activeProfile}</span>
              <span className="tabular-nums">{activeDiameter.toFixed(2)} mm</span>
            </div>
          )}

          {activeProfile !== "flat" && (
            <p className="text-[11px] text-amber-400/80 leading-tight">
              Non-flat profiles render as flat-bottomed kerfs at the nominal diameter for now —{" "}
              {activeProfile === "v"
                ? "v-bit"
                : activeProfile === "ball"
                  ? "ball-nose"
                  : activeProfile}{" "}
              shape modelling lands in a later phase.
            </p>
          )}
        </Section>

        <Section label="Render mode">
          <div className="flex rounded border border-neutral-800 overflow-hidden text-sm">
            {(["csg", "heightmap"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRenderMode(mode)}
                className={`flex-1 px-2 py-1.5 transition ${
                  renderMode === mode
                    ? "bg-amber-400/20 text-amber-200"
                    : "text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                {mode === "csg" ? "CSG" : "Heightmap"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500 leading-tight">
            CSG gives smooth curved walls but can fail on tricky topology. Heightmap is rasterised
            and always renders something, at the cost of stair-stepped walls.
          </p>
        </Section>

        <Section label="Cut volumes">
          <label className="flex items-center justify-between text-sm gap-2">
            <span className="text-neutral-400">Show cut volumes</span>
            <input
              type="checkbox"
              checked={debugCutVolumes}
              onChange={(e) => setDebugCutVolumes(e.target.checked)}
              className="accent-amber-400"
            />
          </label>
          <p className="text-[11px] text-neutral-500 leading-tight">
            Replace the board with the raw extruded volume of every cut. Useful for checking what
            the router will actually remove.
          </p>
        </Section>
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </h2>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  unit,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit: string;
  step?: number;
}) {
  // Local draft so typing doesn't trigger a re-render-per-keystroke (rasterising
  // the depth field is expensive). Commit on Enter or blur; revert on Escape.
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== value) onChange(n);
    else setDraft(String(value));
  };

  return (
    <label className="flex items-center justify-between text-sm gap-2">
      <span className="text-neutral-400">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          value={draft}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            else if (e.key === "Escape") {
              setDraft(String(value));
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-20 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-right text-sm tabular-nums"
        />
        <span className="text-xs text-neutral-500 w-6">{unit}</span>
      </span>
    </label>
  );
}
