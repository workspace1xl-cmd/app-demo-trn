"use client";

import { useEffect, useMemo, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, SimulationNodeDatum } from "d3-force";
import styles from "./platform.module.css";

// The flagship visual for the product: the RACI matrix rendered as an
// actual ownership graph instead of a table. Built from real data only —
// see the honesty notes below for what that means and what it can't show
// (yet).
export type GraphActivity = {
  id: string;
  name: string;
  department: string;
  responsible_role: string;
  current_person: string;
  backup_person: string;
  contact_details: string;
  sla: string;
  escalation_level_1: string;
  escalation_level_2: string;
};

type NodeKind = "department" | "role" | "escalation";
type GraphNode = SimulationNodeDatum & {
  id: string;
  kind: NodeKind;
  label: string;
  // Real signal, not decorative: a role node is "risk" when every activity
  // routed through it still has the seed placeholder current_person
  // ("Organisation to confirm") — i.e. the role is defined but nobody is
  // actually named as the owner. That is genuinely true for 100% of rows
  // in the demo org right now, which the graph should show honestly
  // rather than smooth over.
  tone: "readiness" | "risk" | "ownership";
  activities: GraphActivity[];
};
type GraphLink = { source: string; target: string };

const UNASSIGNED_PLACEHOLDER = "organisation to confirm";

function buildGraph(activities: GraphActivity[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const linkKeys = new Set<string>();

  function upsertNode(id: string, kind: NodeKind, label: string): GraphNode {
    const existing = nodeMap.get(id);
    if (existing) return existing;
    const node: GraphNode = { id, kind, label, tone: kind === "department" ? "ownership" : "readiness", activities: [] };
    nodeMap.set(id, node);
    return node;
  }
  function addLink(a: string, b: string) {
    const key = a < b ? `${a}::${b}` : `${b}::${a}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ source: a, target: b });
  }

  for (const activity of activities) {
    const deptId = `dept:${activity.department}`;
    const roleId = `role:${activity.responsible_role}`;
    const esc1Id = `esc:${activity.escalation_level_1}`;
    const esc2Id = `esc:${activity.escalation_level_2}`;

    const deptNode = upsertNode(deptId, "department", activity.department);
    const roleNode = upsertNode(roleId, "role", activity.responsible_role);
    const esc1Node = upsertNode(esc1Id, "escalation", activity.escalation_level_1);
    const esc2Node = upsertNode(esc2Id, "escalation", activity.escalation_level_2);

    deptNode.activities.push(activity);
    roleNode.activities.push(activity);
    esc1Node.activities.push(activity);
    esc2Node.activities.push(activity);

    addLink(deptId, roleId);
    addLink(roleId, esc1Id);
    addLink(esc1Id, esc2Id);
  }

  // A role node's tone reflects whether ANY of its activities actually has
  // a named owner yet, not just the seed placeholder.
  for (const node of nodeMap.values()) {
    if (node.kind !== "role") continue;
    const hasNamedOwner = node.activities.some((a) => a.current_person.trim().toLowerCase() !== UNASSIGNED_PLACEHOLDER);
    node.tone = hasNamedOwner ? "readiness" : "risk";
  }

  return { nodes: Array.from(nodeMap.values()), links };
}

export default function ResponsibilityGraph({
  activities,
  mode,
  onOpenFull,
  onNodeSelect,
}: {
  activities: GraphActivity[];
  mode: "mini" | "full";
  onOpenFull?: () => void;
  onNodeSelect?: (node: { label: string; kind: NodeKind; activities: GraphActivity[] }) => void;
}) {
  const width = mode === "mini" ? 360 : 900;
  const height = mode === "mini" ? 190 : 560;
  const { nodes, links } = useMemo(() => buildGraph(activities), [activities]);
  const [positions, setPositions] = useState<GraphNode[]>(nodes);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [settled, setSettled] = useState(false);
  // Reset "settled" the moment the graph's underlying data changes, during
  // render rather than inside the effect below (React's documented pattern
  // for "adjust state when a derived value changes" — same fix as the
  // view-change reset in PlatformApp.tsx). nodes/links are memoized on
  // `activities`, so this only fires on a genuine data change, not on
  // every hover-triggered re-render.
  const [resetForNodes, setResetForNodes] = useState(nodes);
  if (nodes !== resetForNodes) {
    setResetForNodes(nodes);
    setSettled(false);
  }

  useEffect(() => {
    // Copy nodes fresh each time activities change so d3 can mutate x/y/vx/vy
    // on its own objects without fighting React state identity.
    const simNodes: GraphNode[] = nodes.map((n) => ({ ...n }));
    const sim = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(mode === "mini" ? -60 : -220))
      .force("link", forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(mode === "mini" ? 46 : 90).strength(0.7))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide(mode === "mini" ? 16 : 26))
      .alphaDecay(0.035);

    // The "one orchestrated moment" from the design pass: the graph
    // resolves into place on load rather than a static layout or scattered
    // micro-animations elsewhere. Ticks drive React state directly instead
    // of a continuous rAF loop once settled, so it doesn't burn cycles
    // forever in the background.
    sim.on("tick", () => setPositions([...simNodes]));
    sim.on("end", () => setSettled(true));

    return () => {
      sim.stop();
    };
  }, [nodes, links, width, height, mode]);

  const nodeById = new Map(positions.map((n) => [n.id, n]));

  return (
    <div className={styles.graphWrap} data-mode={mode}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Responsibility ownership graph">
        <g className={styles.graphLinks}>
          {links.map((l, i) => {
            const s = nodeById.get(typeof l.source === "string" ? l.source : (l.source as unknown as GraphNode).id);
            const t = nodeById.get(typeof l.target === "string" ? l.target : (l.target as unknown as GraphNode).id);
            if (!s || !t || s.x == null || t.x == null) return null;
            return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} />;
          })}
        </g>
        <g>
          {positions.map((n) => {
            if (n.x == null || n.y == null) return null;
            const r = n.kind === "department" ? (mode === "mini" ? 8 : 13) : n.kind === "escalation" ? (mode === "mini" ? 5 : 8) : mode === "mini" ? 6 : 10;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                className={styles.graphNode}
                data-tone={n.tone}
                data-kind={n.kind}
                tabIndex={0}
                role="button"
                aria-label={`${n.label} (${n.kind})`}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered((h) => (h?.id === n.id ? null : h))}
                onFocus={() => setHovered(n)}
                onBlur={() => setHovered((h) => (h?.id === n.id ? null : h))}
                onClick={() => onNodeSelect?.({ label: n.label, kind: n.kind, activities: n.activities })}
              >
                <circle r={r} />
                {mode === "full" && <text y={r + 13}>{n.label}</text>}
              </g>
            );
          })}
        </g>
      </svg>
      {hovered && (
        <div className={styles.graphTooltip} data-tone={hovered.tone}>
          <b>{hovered.label}</b>
          <small>{hovered.kind === "department" ? "Department" : hovered.kind === "role" ? "Responsible role" : "Escalation contact"}</small>
          {hovered.kind === "role" && (
            <p>
              {hovered.tone === "risk"
                ? "No named owner yet — routed to this role only."
                : "Has at least one named owner."}
            </p>
          )}
          {hovered.activities[0] && (
            <p>
              {hovered.activities.length} activit{hovered.activities.length === 1 ? "y" : "ies"} · SLA {hovered.activities[0].sla}
              {hovered.kind !== "escalation" && ` · escalates to ${hovered.activities[0].escalation_level_1}`}
            </p>
          )}
        </div>
      )}
      {mode === "mini" && onOpenFull && (
        <button type="button" className={styles.graphMiniLink} onClick={onOpenFull}>
          View full responsibility graph →
        </button>
      )}
      {!settled && <span className={styles.graphSettling} aria-hidden="true" />}
    </div>
  );
}
