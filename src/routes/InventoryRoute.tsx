import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  dbListInventoryItems,
  dbSaveInventoryItems,
  dbDeleteInventoryItem,
  dbUpdateInventoryItem
} from '../shared/services/db';
import type { InventoryItem } from '../shared/types/inventory';
import { parsePackInfo } from '../shared';
import { pushInventory } from '../shared/services/inventorySync';

export function InventoryRoute() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [editItem, setEditItem] = useState<InventoryItem | null>(null);

  const loadItems = async () => {
    setLoading(true);
    const result = await dbListInventoryItems();
    setItems(result);
    setLoading(false);
  };

  useEffect(() => {
    loadItems();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const data = evt.target?.result;
      const workbook = XLSX.read(data, { type: 'binary' });
      const firstSheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheet];
      
      const json: any[] = XLSX.utils.sheet_to_json(worksheet);
      
      const newItems: InventoryItem[] = json.map(row => {
        const sku = (row['Material'] || row['SKU'] || '').toString().trim();
        const batch = (row['LOTATR3'] || row['BATCH'] || row['Batch'] || '').toString().trim();
        const description = (
          row['Material Description'] ||
          row['Description'] ||
          row['DESCRIPTION'] ||
          ''
        )
          .toString()
          .trim();
        
        return {
          id: `${sku}_${batch}`,
          sku,
          batch,
          description,
          lastUpdated: new Date().toISOString()
        };
      }).filter(item => item.sku && item.batch);

      // Save to IndexedDB
      await dbSaveInventoryItems(newItems);
      // Sync to the cloud so other devices (review screen, PDF) get it too.
      void pushInventory(newItems);

      alert(`Imported ${newItems.length} items successfully.`);
      loadItems();
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this item?')) {
      await dbDeleteInventoryItem(id);
      loadItems();
    }
  };

  const handleSaveEdit = async () => {
    if (editItem) {
      const saved: InventoryItem = {
        ...editItem,
        id: `${editItem.sku}_${editItem.batch}`,
        lastUpdated: new Date().toISOString()
      };
      await dbUpdateInventoryItem(saved);
      void pushInventory([saved]);
      setEditItem(null);
      loadItems();
    }
  };

  const startAddRow = () => {
    setEditItem({
      id: '',
      sku: '',
      batch: '',
      description: '',
      lastUpdated: new Date().toISOString()
    });
  };

  return (
    <div className="view view--with-topbar">
      <div className="layout-content" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h1 className="h1">Inventory Management</h1>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <label className="btn btn-secondary">
              Import Excel
              <input type="file" accept=".xlsx, .xls" style={{ display: 'none' }} onChange={handleFileUpload} />
            </label>
            <button className="btn btn-primary" onClick={startAddRow}>
              Add Item
            </button>
          </div>
        </div>

        {editItem && (
          <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', marginBottom: '1.5rem' }}>
            <h3>{editItem.id ? 'Edit Item' : 'New Item'}</h3>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <input
                className="input"
                placeholder="SKU (Material)"
                value={editItem.sku}
                onChange={(e) => setEditItem({ ...editItem, sku: e.target.value })}
              />
              <input
                className="input"
                placeholder="Batch (LOTATR3)"
                value={editItem.batch}
                onChange={(e) => setEditItem({ ...editItem, batch: e.target.value })}
              />
              <input
                className="input"
                placeholder="Description"
                value={editItem.description}
                style={{ flex: 1 }}
                onChange={(e) => setEditItem({ ...editItem, description: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>Save</button>
            </div>
          </div>
        )}

        {loading ? (
          <p>Loading inventory...</p>
        ) : items.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', border: '2px dashed #ccc', borderRadius: '8px' }}>
            <p>No inventory items found. Import your Inventory.xlsx file to begin.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '8px', border: '1px solid #eee' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '2px solid #eee' }}>
                  <th style={{ padding: '1rem' }}>SKU</th>
                  <th style={{ padding: '1rem' }}>Batch</th>
                  <th style={{ padding: '1rem' }}>Description</th>
                  <th style={{ padding: '1rem' }}>UOM</th>
                  <th style={{ padding: '1rem' }}>Last Updated</th>
                  <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '1rem', fontWeight: 500 }}>{item.sku}</td>
                    <td style={{ padding: '1rem' }}>{item.batch}</td>
                    <td style={{ padding: '1rem' }}>{item.description}</td>
                    <td style={{ padding: '1rem' }}>
                      {(() => {
                        const pack = parsePackInfo(item.description);
                        const uom = pack ? pack.kind : 'Bags';
                        const title = pack
                          ? `${pack.kind === 'MB' ? 'Minibulk' : 'SeedPak'} (${pack.size} bags), read from the material description`
                          : 'Loose bags — no SeedPak/Minibulk pack found in the material description';
                        return (
                          <span
                            title={title}
                            style={{
                              display: 'inline-block',
                              padding: '0.125rem 0.5rem',
                              borderRadius: '999px',
                              background: pack ? '#eef2ff' : '#f3f4f6',
                              color: pack ? '#3730a3' : '#4b5563',
                              fontWeight: 600,
                              fontSize: '0.85rem',
                            }}
                          >
                            {uom}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '1rem', color: '#666' }}>
                      {new Date(item.lastUpdated).toLocaleString()}
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                      <button 
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.75rem', marginRight: '0.5rem' }} 
                        onClick={() => setEditItem(item)}
                      >
                        Edit
                      </button>
                      <button 
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.75rem', color: '#dc2626', borderColor: '#fca5a5' }} 
                        onClick={() => handleDelete(item.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
