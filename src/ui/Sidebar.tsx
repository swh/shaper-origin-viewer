import { type DragEvent, useEffect, useRef, useState } from "react";
import { BITS, CUSTOM_BIT_ID, bitById } from "../depth";
import type { Cut } from "../parser";
import { type Units, useStore } from "../store";
import {
  defaultDecimals,
  defaultStep,
  fromUserUnits,
  toUserUnits,
  trimTrailingZeros,
} from "../units";
import { SPECIES } from "../viewer/species";

export function Sidebar() {
  const {
    svgName,
    boardWidthMm,
    boardHeightMm,
    boardThicknessMm,
    bitId,
    customDiameterMm,
    defaultDepthMm,
    speciesId,
    doc,
    debugCutVolumes,
    loadError,
    placement,
    placeMode,
    cutToolOverrides,
    selectedCutIndices,
    units,
    loadSvg,
    setBoardWidth,
    setBoardHeight,
    setBoardThickness,
    setBitId,
    setCustomDiameter,
    setDefaultDepth,
    setSpecies,
    setDebugCutVolumes,
    setPlacement,
    setPlaceMode,
    setCutToolOverride,
    clearCutToolOverrides,
    setHighlightedCut,
    setCutSelection,
    setUnits,
  } = useStore();
  const selectedBit = bitId === CUSTOM_BIT_ID ? null : bitById(bitId);
  const isCustom = bitId === CUSTOM_BIT_ID;
  const activeDiameter = isCustom ? customDiameterMm : (selectedBit?.diameterMm ?? 0);
  const activeProfile = isCustom ? "flat" : (selectedBit?.profile ?? "flat");
  const metricBits = BITS.filter((b) => b.group === "metric");
  const imperialBits = BITS.filter((b) => b.group === "imperial");

  const cutCount = doc?.cuts.length ?? 0;
  const [isDragging, setIsDragging] = useState(false);

  // Cuts that actually remove material — selection / overrides only apply here.
  const renderableCutIndices: readonly number[] =
    doc?.cuts
      .map((cut, idx) => ({ cut, idx }))
      .filter(({ cut }) => cut.cutType !== "guide" && cut.cutType !== "anchor")
      .map(({ idx }) => idx) ?? [];
  const selCount = selectedCutIndices.length;

  /**
   * Apply a chosen bit (or "Custom") from the global Tool dropdown. With no
   * selection (or every renderable cut selected) the action targets the global
   * default, and a "select all" implicitly clears any per-cut overrides so the
   * change actually shows up everywhere. With a partial selection it sets a
   * per-cut diameter override on each selected cut without touching globals.
   */
  function applyBit(newBitId: string) {
    const newDia =
      newBitId === CUSTOM_BIT_ID
        ? customDiameterMm
        : (bitById(newBitId)?.diameterMm ?? customDiameterMm);

    const allRenderable = renderableCutIndices.length;
    const targetingGlobal = selCount === 0 || selCount === allRenderable;

    if (targetingGlobal) {
      setBitId(newBitId);
      if (selCount === allRenderable && allRenderable > 0) {
        // User explicitly selected every cut → reset overrides so the new
        // global takes effect everywhere, even on cuts that previously had
        // their own override.
        clearCutToolOverrides();
      }
      return;
    }

    // Partial selection: per-cut overrides only.
    for (const idx of selectedCutIndices) {
      setCutToolOverride(idx, newDia);
    }
  }

  async function loadFile(file: File) {
    const text = await file.text();
    loadSvg(text, file.name);
  }
  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  return (
    <aside className="w-80 shrink-0 border-r border-neutral-800 bg-neutral-950 text-neutral-200 overflow-y-auto">
      <div className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Shaper Viewer</h1>
            <p className="text-xs text-neutral-500 mt-0.5">3D preview of Shaper Origin SVG cuts</p>
          </div>
          <div className="flex rounded border border-neutral-800 overflow-hidden text-[11px] shrink-0">
            {(["mm", "in"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnits(u)}
                className={`px-2 py-1 transition ${
                  units === u
                    ? "bg-amber-400/20 text-amber-200"
                    : "text-neutral-500 hover:bg-neutral-900"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        <Section label="Design">
          <label
            className={`block border-2 border-dashed rounded-md px-3 py-5 text-center text-xs cursor-pointer transition ${
              isDragging
                ? "border-amber-400 bg-amber-400/10 text-amber-200"
                : "border-neutral-700 hover:border-neutral-600 text-neutral-400"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept=".svg,image/svg+xml"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
            <span className="block">Drop an SVG here</span>
            <span className="block text-[10px] text-neutral-500 mt-0.5">or click to browse</span>
          </label>

          {loadError && (
            <p className="text-xs text-red-400 leading-tight">Couldn't parse SVG: {loadError}</p>
          )}
          {doc && !loadError && (
            <p className="text-xs text-neutral-500">
              {svgName} —{" "}
              {trimTrailingZeros(toUserUnits(doc.widthMm, units), defaultDecimals(units))} ×{" "}
              {trimTrailingZeros(toUserUnits(doc.heightMm, units), defaultDecimals(units))} {units},{" "}
              {cutCount} cut{cutCount === 1 ? "" : "s"}
            </p>
          )}
        </Section>

        {doc && (
          <Section label="Placement">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setPlaceMode(!placeMode)}
                className={`flex-1 rounded border px-2 py-1.5 text-sm transition ${
                  placeMode
                    ? "border-amber-400 bg-amber-400/15 text-amber-200"
                    : "border-neutral-800 hover:border-neutral-600 text-neutral-300"
                }`}
              >
                {placeMode ? "Click on the board…" : "Move design"}
              </button>
              {placement && (
                <button
                  type="button"
                  onClick={() => {
                    setPlacement(null);
                    setPlaceMode(false);
                  }}
                  className="rounded border border-neutral-800 hover:border-neutral-600 px-2 py-1.5 text-xs text-neutral-400"
                  title="Reset to centred placement"
                >
                  Reset
                </button>
              )}
            </div>
            <p className="text-[11px] text-neutral-500 leading-tight">
              {placeMode
                ? "Click on the board to drop the design. Esc to cancel."
                : placement
                  ? `${doc?.anchor ? "Anchor" : "Centre"} at ${trimTrailingZeros(
                      toUserUnits(placement.x, units),
                      defaultDecimals(units),
                    )}, ${trimTrailingZeros(
                      toUserUnits(placement.y, units),
                      defaultDecimals(units),
                    )} ${units}`
                  : doc?.anchor
                    ? "Anchor at board centre."
                    : "Auto-centred on the board."}
            </p>
            <p className="text-[11px] text-neutral-600 leading-tight">
              Tip: hold Shift and drag on the board to nudge the design without entering move mode.
            </p>
          </Section>
        )}

        <Section label="Board">
          <NumberRow
            label="Width"
            valueMm={boardWidthMm}
            onChangeMm={setBoardWidth}
            units={units}
          />
          <NumberRow
            label="Length"
            valueMm={boardHeightMm}
            onChangeMm={setBoardHeight}
            units={units}
          />
          <NumberRow
            label="Thickness"
            valueMm={boardThicknessMm}
            onChangeMm={setBoardThickness}
            units={units}
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
                style={{
                  background: `linear-gradient(135deg, ${s.light} 0%, ${s.light} 60%, ${s.dark} 100%)`,
                }}
                title={s.label}
              />
            ))}
          </div>
        </Section>

        <Section label="Tool">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400 flex items-center justify-between">
              <span>Bit</span>
              {selCount > 0 && selCount < renderableCutIndices.length && (
                <span className="text-[10px] text-amber-300/80 normal-case">
                  applies to {selCount} selected
                </span>
              )}
            </span>
            <select
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-sm"
              value={bitId}
              onChange={(e) => applyBit(e.target.value)}
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
              valueMm={customDiameterMm}
              onChangeMm={setCustomDiameter}
              units={units}
            />
          ) : (
            <div className="flex items-center justify-between text-xs text-neutral-500 px-0.5">
              <span>Profile: {activeProfile}</span>
              <span className="tabular-nums">
                {trimTrailingZeros(toUserUnits(activeDiameter, units), defaultDecimals(units))}{" "}
                {units}
              </span>
            </div>
          )}

          <NumberRow
            label="Default depth"
            valueMm={defaultDepthMm}
            onChangeMm={setDefaultDepth}
            units={units}
          />
          <p className="text-[11px] text-neutral-500 leading-tight">
            Used for cuts in the SVG that don't carry a <code>shaper:cutDepth</code> attribute.
          </p>

          {activeProfile !== "flat" && activeProfile !== "v" && (
            <p className="text-[11px] text-amber-400/80 leading-tight">
              Non-flat profiles render as flat-bottomed kerfs at the nominal diameter for now —{" "}
              {activeProfile === "ball" ? "ball-nose" : activeProfile} shape modelling lands in a
              later phase.
            </p>
          )}
        </Section>

        {doc && doc.cuts.length > 0 && (
          <Section label="Cuts">
            <CutsList
              cuts={doc.cuts}
              defaultDiameterMm={activeDiameter}
              overrides={cutToolOverrides}
              selectedIndices={selectedCutIndices}
              units={units}
              onSetOverride={setCutToolOverride}
              onResetAll={clearCutToolOverrides}
              onHighlight={setHighlightedCut}
              onSelectionChange={setCutSelection}
            />
          </Section>
        )}

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
  valueMm,
  onChangeMm,
  units,
  step,
}: {
  label: string;
  valueMm: number;
  onChangeMm: (mm: number) => void;
  units: Units;
  step?: number;
}) {
  // Always display in user's units; persist in mm. Local draft prevents a
  // re-render storm (rasterising the depth field is expensive); commit on
  // Enter or blur, revert on Escape.
  const decimals = defaultDecimals(units);
  const formatted = trimTrailingZeros(toUserUnits(valueMm, units), decimals);
  const [draft, setDraft] = useState(() => formatted);
  useEffect(() => {
    setDraft(formatted);
  }, [formatted]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(formatted);
      return;
    }
    const newMm = fromUserUnits(n, units);
    if (Math.abs(newMm - valueMm) > 1e-6) onChangeMm(newMm);
    else setDraft(formatted);
  };

  return (
    <label className="flex items-center justify-between text-sm gap-2">
      <span className="text-neutral-400">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          value={draft}
          step={step ?? defaultStep(units)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            else if (e.key === "Escape") {
              setDraft(formatted);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-20 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-right text-sm tabular-nums"
        />
        <span className="text-xs text-neutral-500 w-6">{units}</span>
      </span>
    </label>
  );
}

function CutsList({
  cuts,
  defaultDiameterMm,
  overrides,
  selectedIndices,
  units,
  onSetOverride,
  onResetAll,
  onHighlight,
  onSelectionChange,
}: {
  cuts: readonly Cut[];
  defaultDiameterMm: number;
  overrides: Record<number, number>;
  selectedIndices: readonly number[];
  units: Units;
  onSetOverride: (cutIndex: number, diameterMm: number | null) => void;
  onResetAll: () => void;
  onHighlight: (index: number | null) => void;
  onSelectionChange: (indices: number[]) => void;
}) {
  // Skip cuts that don't actually remove material — diameter has no effect.
  const renderable = cuts
    .map((cut, originalIdx) => ({ cut, originalIdx }))
    .filter(({ cut }) => cut.cutType !== "guide" && cut.cutType !== "anchor");
  const renderableIndices = renderable.map((r) => r.originalIdx);

  const overrideCount = Object.keys(overrides).length;
  const selectedSet = new Set(selectedIndices);
  const allSelected = selectedSet.size === renderable.length && renderable.length > 0;
  const lastClickedRef = useRef<number | null>(null);

  function clickRow(idx: number, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    if (e.shiftKey && lastClickedRef.current != null) {
      // Range from last anchor to clicked, restricted to renderable cuts.
      const lo = Math.min(lastClickedRef.current, idx);
      const hi = Math.max(lastClickedRef.current, idx);
      const range = renderableIndices.filter((i) => i >= lo && i <= hi);
      onSelectionChange(range);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = selectedSet.has(idx)
        ? selectedIndices.filter((i) => i !== idx)
        : [...selectedIndices, idx];
      onSelectionChange(next);
      lastClickedRef.current = idx;
      return;
    }
    // Plain click: select only this cut, or clear if it was the only one.
    if (selectedIndices.length === 1 && selectedIndices[0] === idx) {
      onSelectionChange([]);
      lastClickedRef.current = null;
    } else {
      onSelectionChange([idx]);
      lastClickedRef.current = idx;
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>
          {renderable.length} cut{renderable.length === 1 ? "" : "s"}
          {selectedSet.size > 0 && ` · ${selectedSet.size} selected`}
          {overrideCount > 0 && ` · ${overrideCount} overridden`}
        </span>
        <div className="flex gap-2">
          {selectedSet.size > 0 && (
            <button
              type="button"
              onClick={() => onSelectionChange([])}
              className="text-neutral-400 hover:text-neutral-200"
            >
              Deselect
            </button>
          )}
          {!allSelected && renderable.length > 0 && (
            <button
              type="button"
              onClick={() => onSelectionChange(renderableIndices)}
              className="text-neutral-400 hover:text-neutral-200"
            >
              Select all
            </button>
          )}
          {overrideCount > 0 && (
            <button
              type="button"
              onClick={onResetAll}
              className="text-neutral-400 hover:text-neutral-200"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto pr-1 space-y-0.5">
        {renderable.map(({ cut, originalIdx }) => (
          <CutRow
            key={originalIdx}
            index={originalIdx}
            cut={cut}
            defaultDiameterMm={cut.toolDiaMm ?? defaultDiameterMm}
            overrideDiameterMm={overrides[originalIdx] ?? null}
            selected={selectedSet.has(originalIdx)}
            units={units}
            onChange={(d) => onSetOverride(originalIdx, d)}
            onHighlight={onHighlight}
            onClickRow={(e) => clickRow(originalIdx, e)}
          />
        ))}
      </div>
    </div>
  );
}

function CutRow({
  index,
  cut,
  defaultDiameterMm,
  overrideDiameterMm,
  selected,
  units,
  onChange,
  onHighlight,
  onClickRow,
}: {
  index: number;
  cut: Cut;
  defaultDiameterMm: number;
  overrideDiameterMm: number | null;
  selected: boolean;
  units: Units;
  onChange: (mm: number | null) => void;
  onHighlight: (index: number | null) => void;
  onClickRow: (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
}) {
  const decimals = defaultDecimals(units);
  const formattedOverride =
    overrideDiameterMm == null
      ? ""
      : trimTrailingZeros(toUserUnits(overrideDiameterMm, units), decimals);
  const placeholderDia = trimTrailingZeros(toUserUnits(defaultDiameterMm, units), decimals);
  const [draft, setDraft] = useState<string>(formattedOverride);
  useEffect(() => {
    setDraft(formattedOverride);
  }, [formattedOverride]);

  // Focus persists the highlight even if the mouse leaves the row, so we
  // don't clear on mouseleave while focused.
  const focusedRef = useRef(false);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (overrideDiameterMm != null) onChange(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      setDraft(formattedOverride);
      return;
    }
    const newMm = fromUserUnits(n, units);
    if (overrideDiameterMm == null || Math.abs(newMm - overrideDiameterMm) > 1e-6) onChange(newMm);
    else setDraft(formattedOverride);
  };

  const rowClasses = selected
    ? "bg-amber-400/15 ring-1 ring-amber-400/40"
    : "hover:bg-neutral-900/60";

  return (
    <div
      className={`flex items-center gap-1.5 text-xs py-0.5 -mx-1 px-1 rounded ${rowClasses}`}
      onMouseEnter={() => onHighlight(index)}
      onMouseLeave={() => {
        if (!focusedRef.current) onHighlight(null);
      }}
    >
      <button
        type="button"
        className="flex-1 truncate text-left text-neutral-300 cursor-pointer"
        onClick={(e) =>
          onClickRow({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })
        }
        title="Click to select. Shift to range-select, Cmd/Ctrl to toggle."
      >
        <span className="text-neutral-600 mr-1 tabular-nums">
          {(index + 1).toString().padStart(2, "0")}
        </span>
        <span className="text-neutral-200">{cut.cutType}</span>
        {cut.depthMm != null && (
          <span className="text-neutral-500">
            {" "}
            · {trimTrailingZeros(toUserUnits(cut.depthMm, units), decimals)} {units}
          </span>
        )}
      </button>
      <input
        type="number"
        value={draft}
        placeholder={placeholderDia}
        step={defaultStep(units)}
        min={0}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          focusedRef.current = true;
          onHighlight(index);
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
          onHighlight(null);
        }}
        onWheel={(e) => (e.target as HTMLInputElement).blur()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setDraft(formattedOverride);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`w-14 bg-neutral-900 border rounded px-1.5 py-0.5 text-right tabular-nums ${
          overrideDiameterMm != null
            ? "border-amber-400/50 text-amber-200"
            : "border-neutral-800 text-neutral-300"
        }`}
        title={
          overrideDiameterMm == null
            ? `Default ${placeholderDia} ${units} — type a number to override`
            : "Overridden — clear to revert"
        }
      />
      <span className="text-[10px] text-neutral-500 w-3">{units}</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        disabled={overrideDiameterMm == null}
        className={`w-4 text-center ${
          overrideDiameterMm == null
            ? "text-neutral-700 cursor-default"
            : "text-neutral-400 hover:text-neutral-200"
        }`}
        title={overrideDiameterMm == null ? "" : "Reset to default"}
      >
        ×
      </button>
    </div>
  );
}
