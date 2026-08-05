import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { OntologyDomainCategory, OntologyGraph, OntologyNode } from '../shared/types/ontology';

interface OntologyGraphViewerProps {
  graph: OntologyGraph;
  selectedCategory: string;
  searchQuery: string;
  onNodeSelect?: (node: OntologyNode | null) => void;
}

const CATEGORY_COLORS: Record<OntologyDomainCategory, { bg: string; border: string; text: string }> = {
  Facility: { bg: '#1e293b', border: '#3b82f6', text: '#60a5fa' },
  Order: { bg: '#0f172a', border: '#10b981', text: '#34d399' },
  Asset: { bg: '#172554', border: '#6366f1', text: '#818cf8' },
  Audit: { bg: '#312e81', border: '#ec4899', text: '#f472b6' },
  AI: { bg: '#311b92', border: '#8b5cf6', text: '#c084fc' },
};

interface NodePos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const OntologyGraphViewer: React.FC<OntologyGraphViewerProps> = ({
  graph,
  selectedCategory,
  searchQuery,
  onNodeSelect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<OntologyNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<OntologyNode | null>(null);

  // Zoom & Pan
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Dragging Nodes
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);

  // Filter nodes & edges based on category & search query
  const filteredNodes = useMemo(() => {
    return graph.nodes.filter((node) => {
      const matchCat = selectedCategory === 'ALL' || node.category === selectedCategory;
      const matchQuery =
        !searchQuery.trim() ||
        node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.type.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchQuery;
    });
  }, [graph.nodes, selectedCategory, searchQuery]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    return graph.edges.filter(
      (edge) => filteredNodeIds.has(edge.sourceId) && filteredNodeIds.has(edge.targetId)
    );
  }, [graph.edges, filteredNodeIds]);

  // Initial layout for nodes
  const [positions, setPositions] = useState<Record<string, NodePos>>({});

  useEffect(() => {
    const nextPositions: Record<string, NodePos> = {};
    const count = filteredNodes.length;
    const centerX = 480;
    const centerY = 320;
    const radius = Math.min(centerX, centerY) * 0.7;

    filteredNodes.forEach((node, i) => {
      if (positions[node.id]) {
        nextPositions[node.id] = positions[node.id];
      } else {
        const angle = (i / Math.max(1, count)) * 2 * Math.PI;
        nextPositions[node.id] = {
          x: centerX + radius * Math.cos(angle) + (Math.random() - 0.5) * 30,
          y: centerY + radius * Math.sin(angle) + (Math.random() - 0.5) * 30,
          vx: 0,
          vy: 0,
        };
      }
    });
    setPositions(nextPositions);
  }, [filteredNodes.map((n) => n.id).join(',')]);

  // Simple layout relaxation effect
  useEffect(() => {
    if (!filteredNodes.length) return;
    const timer = setInterval(() => {
      setPositions((prev) => {
        const updated = { ...prev };
        let moved = false;

        const ids = Object.keys(updated);
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const p1 = updated[ids[i]];
            const p2 = updated[ids[j]];
            if (!p1 || !p2) continue;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist < 130) {
              const force = (130 - dist) * 0.05;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;

              if (ids[i] !== draggedNodeId) {
                updated[ids[i]] = { ...p1, x: p1.x - fx, y: p1.y - fy };
              }
              if (ids[j] !== draggedNodeId) {
                updated[ids[j]] = { ...p2, x: p2.x + fx, y: p2.y + fy };
              }
              moved = true;
            }
          }
        }

        return moved ? updated : prev;
      });
    }, 50);

    return () => clearInterval(timer);
  }, [draggedNodeId, filteredNodes]);

  // Mouse handlers for pan & drag
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).classList.contains('graph-bg')) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setTransform((prev) => ({
        ...prev,
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      }));
    } else if (draggedNodeId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = (e.clientX - rect.left - transform.x) / transform.scale;
        const mouseY = (e.clientY - rect.top - transform.y) / transform.scale;
        setPositions((prev) => ({
          ...prev,
          [draggedNodeId]: { ...prev[draggedNodeId], x: mouseX, y: mouseY },
        }));
      }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggedNodeId(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.3, Math.min(3, prev.scale * zoomFactor)),
    }));
  };

  const resetView = () => {
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  const handleSelectNode = (node: OntologyNode) => {
    setSelectedNode(node);
    if (onNodeSelect) onNodeSelect(node);
  };

  // Connected edges for selected node
  const selectedConnectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return filteredEdges.filter(
      (e) => e.sourceId === selectedNode.id || e.targetId === selectedNode.id
    );
  }, [selectedNode, filteredEdges]);

  return (
    <div className="ontology-viewer-container">
      {/* Controls Bar */}
      <div className="ontology-viewer-controls">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setTransform((t) => ({ ...t, scale: t.scale * 1.2 }))}>
          Zoom In +
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setTransform((t) => ({ ...t, scale: t.scale * 0.8 }))}>
          Zoom Out -
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={resetView}>
          Center Reset
        </button>
        <div className="soft" style={{ fontSize: '0.85rem' }}>
          Nodes: <strong>{filteredNodes.length}</strong> | Edges: <strong>{filteredEdges.length}</strong>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div
        ref={containerRef}
        className="ontology-viewer-canvas graph-bg"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      >
        <svg
          className="ontology-svg"
          width="100%"
          height="100%"
          style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
            </marker>
            <marker
              id="arrow-active"
              viewBox="0 0 10 10"
              refX="26"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
            </marker>
          </defs>

          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
            {/* Render Relationship Edges */}
            {filteredEdges.map((edge) => {
              const src = positions[edge.sourceId];
              const tgt = positions[edge.targetId];
              if (!src || !tgt) return null;

              const isHighlighted =
                selectedNode && (edge.sourceId === selectedNode.id || edge.targetId === selectedNode.id);

              const midX = (src.x + tgt.x) / 2;
              const midY = (src.y + tgt.y) / 2;

              return (
                <g key={edge.id} className="ontology-edge-group">
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke={isHighlighted ? '#38bdf8' : '#334155'}
                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                    strokeDasharray={edge.relation === 'PREDICTS' || edge.relation === 'COLLECTS' ? '4 4' : undefined}
                    markerEnd={isHighlighted ? 'url(#arrow-active)' : 'url(#arrow)'}
                  />
                  {edge.label && (
                    <text
                      x={midX}
                      y={midY - 4}
                      fill={isHighlighted ? '#7dd3fc' : '#94a3b8'}
                      fontSize={11}
                      textAnchor="middle"
                      className="ontology-edge-label"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Render Nodes */}
            {filteredNodes.map((node) => {
              const pos = positions[node.id] || { x: 400, y: 300 };
              const colors = CATEGORY_COLORS[node.category] || CATEGORY_COLORS.Asset;
              const isSelected = selectedNode?.id === node.id;
              const isHovered = hoveredNode?.id === node.id;

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  className={`ontology-node-group ${isSelected ? 'selected' : ''}`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDraggedNodeId(node.id);
                    handleSelectNode(node);
                  }}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    r={24}
                    fill={colors.bg}
                    stroke={isSelected ? '#38bdf8' : isHovered ? '#f43f5e' : colors.border}
                    strokeWidth={isSelected || isHovered ? 3.5 : 2}
                    className="ontology-node-circle"
                  />

                  {/* Category Indicator Dot */}
                  <circle r={5} cx={-15} cy={-15} fill={colors.border} />

                  {/* Node Icon / Initial */}
                  <text
                    textAnchor="middle"
                    dy=".3em"
                    fill="#f8fafc"
                    fontSize={12}
                    fontWeight="bold"
                    pointerEvents="none"
                  >
                    {node.type.slice(0, 2).toUpperCase()}
                  </text>

                  {/* Node Label */}
                  <text
                    textAnchor="middle"
                    y={38}
                    fill={isSelected ? '#38bdf8' : '#e2e8f0'}
                    fontSize={12}
                    fontWeight={isSelected ? 'bold' : 'normal'}
                    className="ontology-node-text"
                  >
                    {node.label}
                  </text>

                  <text
                    textAnchor="middle"
                    y={52}
                    fill="#64748b"
                    fontSize={10}
                  >
                    {node.category}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Side Inspector Drawer */}
      {selectedNode && (
        <div className="ontology-inspector-drawer">
          <div className="ontology-inspector-header">
            <div>
              <span
                className="ontology-badge"
                style={{
                  backgroundColor: CATEGORY_COLORS[selectedNode.category].bg,
                  borderColor: CATEGORY_COLORS[selectedNode.category].border,
                  color: CATEGORY_COLORS[selectedNode.category].text,
                }}
              >
                {selectedNode.category}
              </span>
              <h3 style={{ marginTop: '0.4rem', marginBottom: '0.2rem' }}>{selectedNode.label}</h3>
              <div className="soft" style={{ fontSize: '0.85rem' }}>
                Type: <code>{selectedNode.type}</code> | ID: <code>{selectedNode.id}</code>
              </div>
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setSelectedNode(null)}
            >
              ✕ Close
            </button>
          </div>

          <div className="ontology-inspector-body">
            <h4 style={{ marginTop: '0.8rem', marginBottom: '0.4rem' }}>Connected Relationships ({selectedConnectedEdges.length})</h4>
            {selectedConnectedEdges.length === 0 ? (
              <p className="soft">No active relationships connected.</p>
            ) : (
              <ul className="ontology-edge-list">
                {selectedConnectedEdges.map((e) => {
                  const isSource = e.sourceId === selectedNode.id;
                  const otherNodeId = isSource ? e.targetId : e.sourceId;
                  const otherNode = graph.nodes.find((n) => n.id === otherNodeId);
                  return (
                    <li key={e.id} className="ontology-edge-item">
                      <span className="ontology-edge-dir">
                        {isSource ? '──► Outgoing' : '◄── Incoming'}
                      </span>
                      <strong>{e.relation}</strong> ({e.label || 'relates'})
                      <div>
                        Target: <span className="highlight">{otherNode?.label || otherNodeId}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <h4 style={{ marginTop: '1rem', marginBottom: '0.4rem' }}>Object Properties & Payload</h4>
            <pre className="ontology-json-viewer">
              {JSON.stringify(selectedNode.properties, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
