import React, { useState } from 'react';
import { useT } from '../i18n/LanguageContext';
import './KanbanBoard.css';

export interface KanbanColumnDef {
  id: string;
  title: string;
  colorTheme: 'yellow' | 'purple' | 'blue' | 'green' | 'red' | 'gray';
}

export interface KanbanCardDef {
  id: string;
  columnId: string;
  title: string;
  subtitle?: string;
  user?: { name: string; avatar?: string; time: string };
  statusTags?: { label: string; color: string }[];
  onClick?: () => void;
}

export interface KanbanBoardProps {
  columns: KanbanColumnDef[];
  cards: KanbanCardDef[];
  onMoveCard: (cardId: string, toColumnId: string) => void;
}

export function KanbanBoard({ columns, cards, onMoveCard }: KanbanBoardProps) {
  const t = useT();
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    setDraggedCardId(cardId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardId);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColId !== colId) {
      setDragOverColId(colId);
    }
  };

  const handleDragLeave = (_e: React.DragEvent, colId: string) => {
    if (dragOverColId === colId) {
      setDragOverColId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDragOverColId(null);
    const cardId = e.dataTransfer.getData('text/plain');
    if (cardId) {
      onMoveCard(cardId, colId);
    }
    setDraggedCardId(null);
  };

  const handleDragEnd = () => {
    setDraggedCardId(null);
    setDragOverColId(null);
  };

  return (
    <div className="kanban-container">
      {columns.map((col) => {
        const colCards = cards.filter((c) => c.columnId === col.id);
        
        return (
          <div
            key={col.id}
            className={`kanban-column kanban-theme-${col.colorTheme} ${dragOverColId === col.id ? 'drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={(e) => handleDragLeave(e, col.id)}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <div className="kanban-column-header">
              <span>{col.title}</span>
              <span className="opacity-75" style={{ fontSize: '11px', background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '12px' }}>
                {colCards.length}
              </span>
            </div>
            
            <div className="kanban-cards-container">
              {colCards.map((card) => (
                <div
                  key={card.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, card.id)}
                  onDragEnd={handleDragEnd}
                  onClick={card.onClick}
                  className={`kanban-card ${draggedCardId === card.id ? 'dragging' : ''}`}
                >
                  <div className="d-flex justify-content-between align-items-start">
                    <div className="kanban-card-title">{card.title}</div>
                  </div>
                  
                  {card.subtitle && (
                    <div className="kanban-card-subtitle">{card.subtitle}</div>
                  )}

                  {card.user && (
                    <div className="mt-3">
                      <div className="kanban-card-log-header">{t('kanban.activityLog', 'Activity Log')}</div>
                      <div className="kanban-card-user-info">
                        <div className="kanban-card-avatar">
                          {card.user.avatar ? (
                            <img src={card.user.avatar} alt={card.user.name} style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                          ) : (
                            card.user.name.charAt(0)
                          )}
                        </div>
                        <div className="kanban-card-meta">
                          {t('kanban.createdBy', 'Created by')} <strong>{card.user.name}</strong>,<br />
                          {card.user.time}
                        </div>
                      </div>
                    </div>
                  )}

                  {card.statusTags && card.statusTags.length > 0 && (
                    <div className="kanban-tags">
                      {card.statusTags.map((tag, idx) => (
                        <div key={idx} className="kanban-tag">
                          <div className="kanban-tag-dot" style={{ backgroundColor: tag.color }}></div>
                          {tag.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
