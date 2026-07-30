export const components: Record<string, string> = {
  // StagingLanesMap
  'lanes.eastWarehouse': 'Almacén Este',
  'lanes.westWarehouse': 'Almacén Oeste',
  'lanes.laneTitle': 'Carril {name}',
  'lanes.loadType': 'Tipo de carga',
  'lanes.status': 'Estado',
  'lanes.loadId': 'ID de carga',
  'lanes.carrier': 'Transportista',
  'lanes.expectedPallets': 'Tarimas esperadas',
  'lanes.empty': 'Este carril está vacío.',

  // QualityFlagButton
  'quality.flagIssueAria': 'Marcar problema de calidad',
  'quality.flagged': '⚑ Marcado',
  'quality.flagIssue': '⚑ Marcar problema',
  'quality.editTitle': 'Editar marca de calidad',
  'quality.flagTitle': 'Marcar problema de calidad',
  'quality.subPhoto': 'Marque esta foto como problema de calidad.',
  'quality.subPallet': 'Marque toda esta tarima como problema de calidad.',
  'quality.subInspection': 'Marque toda esta carga como problema de calidad.',
  'quality.reasonLegend': 'Motivo (obligatorio)',
  'quality.reasonDamagedProduct': 'Producto / empaque dañado',
  'quality.reasonWrongLabel': 'Etiqueta incorrecta o faltante',
  'quality.reasonWrongBatch': 'Código de lote / info de producto incorrecta',
  'quality.reasonQuantity': 'Discrepancia de cantidad',
  'quality.reasonOther': 'Otro',
  'quality.specifyLabel': 'Especifique (obligatorio)',
  'quality.specifyPlaceholder': 'Describa el problema',
  'quality.notesLabel': 'Notas (opcional)',
  'quality.notesPlaceholder': 'Contexto adicional...',
  'quality.removeFlag': 'Quitar marca',
  'quality.cancel': 'Cancelar',
  'quality.updateFlag': 'Actualizar marca',
  'quality.saveFlag': 'Guardar marca',

  // KanbanBoard
  'kanban.activityLog': 'Registro de actividad',
  'kanban.createdBy': 'Creado por',

  // SuggestableField
  'suggest.mlHint': 'Autocompletado de un documento escaneado. Confirme o corrija.',
  'suggest.aiConfirm': '✨ IA{pct} · confirmar',
  'suggest.scanBarcode': 'Escanear código de barras',

  // PhotoLightbox
  'lightbox.photoAlt': 'Foto',
  'lightbox.unavailable': 'Foto no disponible en este dispositivo',
  'lightbox.retake': '📷 Volver a tomar foto',
  'lightbox.rotate': '↻ Rotar foto',
  'lightbox.close': '✕ Cerrar',

  // ImageQualityModal
  'imgQuality.titleBlocking': '✋ Debe volver a tomar la foto',
  'imgQuality.titleSevere': '⚠ Problema de calidad de la foto',
  'imgQuality.titleMinor': '⚠ La foto podría mejorar',
  'imgQuality.subBlocking': 'Esta foto no cumple los requisitos y no se puede conservar.',
  'imgQuality.subSevere':
    'La imagen tiene problemas que dificultan leerla. Vuelva a tomarla.',
  'imgQuality.subMinor':
    'La imagen es utilizable pero no es perfecta. Vuelva a tomarla si puede.',
  'imgQuality.previewAlt': 'Vista previa de la foto tomada',
  'imgQuality.trainingNote':
    'Si conserva esta foto, se marcará para entrenamiento de IA y así el modelo aprenderá de la calidad real de las imágenes.',
  'imgQuality.keepAnyway': 'Conservar de todos modos',
  'imgQuality.retake': '📷 Volver a tomar foto',

  // Quality-issue messages, keyed by (type, severity) in ImageQualityModal.
  'imgQuality.msg.sideways':
    'Esta foto es más ancha que alta. Si sostuvo el dispositivo en vertical, puede conservarla; si no, vuelva a tomarla en vertical.',
  'imgQuality.msg.blurrySevere':
    'Esta foto se ve muy borrosa. Asegúrese de sostener la cámara firme.',
  'imgQuality.msg.blurryMild':
    'Esta foto puede estar algo desenfocada. Verifique que todo se vea nítido.',
  'imgQuality.msg.tooDarkSevere':
    'La foto está muy oscura. Encienda más luces o use el flash.',
  'imgQuality.msg.tooDarkMild': 'La foto se ve un poco oscura. Más luz ayudaría.',
  'imgQuality.msg.tooBright':
    'La foto está sobreexpuesta. Aléjese de la fuente de luz.',
  'imgQuality.msg.lowContrast':
    'La foto tiene muy poco contraste. Asegúrese de que el sujeto se vea claramente.',

  // ViewEditToggle
  'viewEdit.groupAria': 'Ver o editar esta inspección',
  'viewEdit.view': '👁 Ver',
  'viewEdit.edit': '✎ Editar',

  // InspectorPicker
  'inspectorPicker.placeholder': 'Seleccione inspector…',
};
