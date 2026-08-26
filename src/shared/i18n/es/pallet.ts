export const pallet: Record<string, string> = {
  // ---- Pallet scan screen: header ----
  'pallet.headPallet': 'Tarima',
  'pallet.headDelivery': 'Entrega',
  'pallet.headStop': 'Parada {number}',
  'pallet.back': '← Atrás',
  'pallet.viewBannerPre': 'Esta inspección está completa y abierta en',
  'pallet.viewBannerMode': 'modo de vista',
  'pallet.viewBannerPost': '. Cambie a Editar en la esquina para modificar algo.',

  // ---- Pallet type (display only — the stored value stays in English) ----
  'pallet.typeLabel': 'Tipo de tarima',
  'pallet.typeFullBag': 'Tarima completa de bolsas',
  'pallet.typePartialBag': 'Tarima parcial de bolsas',
  'pallet.typeMixedBag': 'Tarima mixta de bolsas',
  'pallet.typeSeedpak': 'Seedpak',
  'pallet.typeMinibulk': 'Minibulk',

  // ---- Returns warnings ----
  'pallet.warnFullUnder60':
    'Las tarimas completas de bolsas deben contener exactamente 60 bolsas. Como esta tarima tiene menos de 60 bolsas ({count}), debe marcarse como tarima parcial de bolsas.',
  'pallet.warnPartialOver60':
    'Una tarima parcial de bolsas debe contener menos de 60 bolsas. Como esta tarima tiene 60 bolsas o más ({count}), debe marcarse como tarima completa de bolsas.',
  'pallet.warnDuplicateBatch':
    'Hay otra tarima (Tarima {pallet}) con el lote {batch} que también tiene menos de 60 bolsas ({count} bolsas). Considere consolidarlas.',

  // ---- Batch sections ----
  'pallet.batchDataTitle': 'Datos del lote',
  'pallet.batchSectionsTitle': 'Secciones de lote',
  'pallet.batchesOnPallet': '{count} lotes en esta tarima',
  'pallet.batchNumber': 'Lote {number}',
  'pallet.batchCodeLabel': 'Código de lote',
  'pallet.actualCount': 'Cantidad real',
  'pallet.mismatchPre': 'Discrepancia de conteo: esperado',
  'pallet.mismatchMid': ', se ingresó',
  'pallet.mismatchDiff': 'diferencia {diff}',
  'pallet.notOnPicklist': 'No está en la lista de surtido',
  'pallet.unlistedBatchWarn':
    'Advertencia: El lote "{code}" no estaba en la lista de surtido original. Un verificador puede agregarlo, pero permanecerá marcado para la revisión final.',
  'tally.originalPicklistExceptionTitle':
    'Agregado por el verificador; no estaba en la lista de surtido original',
  'tally.unlistedBadge': 'NO LISTADO',


  // ---- Layer counter ----
  'pallet.fullLayer': 'Capa completa',
  'pallet.fullLayerHint': 'bolsas por capa',
  'pallet.fullStack': 'Estiba completa',
  'pallet.fullStackHint': 'capas completas',
  'pallet.partial': 'Parcial',
  'pallet.partialHint': 'bolsas arriba',
  'pallet.bagsUnit': 'bolsas',
  'pallet.layerApplied': '✓ Aplicado',
  'pallet.layerApply': 'Usar como cantidad real',

  // ---- Inspection result ----
  'pallet.damageTitle': 'Daño',
  'pallet.orderVerificationTitle': 'Verificación del pedido',
  'pallet.qDamaged':
    '* ¿Hubo algún daño (agujeros de roedor, Seedpaks/bolsas sin llenar o bolsas/cajas muy dañadas)?',
  'pallet.qPassInspection':
    '* ¿La tarima de bolsas aprueba la inspección sin hallazgos? (Sin daños, toda la información coincide, todas las etiquetas aplicadas)',
  'pallet.pass': 'Aprobada',
  'pallet.fail': 'Rechazada',
  'pallet.yes': 'Sí',
  'pallet.no': 'No',
  'pallet.na': 'N/A',
  'pallet.lpnLabel': '* ¿Cuál es el número de LPN?',
  'pallet.lpnPlaceholder': 'Ingrese el número de LPN...',
  'pallet.accuracyLabel': '* ¿Tiene adherida la etiqueta de verificación de exactitud?',
  'pallet.photographDamage': '* Tome una foto del daño',
  'pallet.damagePhotoSlot': 'Foto del daño',

  // ---- Findings (display only — the stored value stays in English) ----
  'pallet.selectFindings': '* Seleccione todos los hallazgos de {type}',
  'pallet.findingPickedShort': 'Surtido de menos',
  'pallet.findingPickedLong': 'Surtido de más',
  'pallet.findingWrongLpn': 'LPN incorrecto',
  'pallet.findingMissedScan': 'Escaneo omitido',
  'pallet.findingNotInventory': 'No pasó por inventario',
  'pallet.findingStagingError':
    'Error de preparación (ubicación incorrecta, paradas mezcladas, etc.)',
  'pallet.findingPoorWrapping': 'Envoltura deficiente',
  'pallet.findingBagsDmg': 'Bolsas dañadas',
  'pallet.findingPalletDmg': 'Tarima dañada / bolsa',
  'pallet.findingPalletDirty': 'Tarima sucia',
  'pallet.findingStackingIssue': 'Problema de estiba',
  'pallet.findingTagsMissing': 'Faltan etiquetas',
  'pallet.findingDamageDate': 'Daño / rechazo - fecha en la etiqueta',
  'pallet.findingDamagePlotSeed': 'Daño / rechazo - semilla de parcela',
  'pallet.findingOther': 'Otro',

  // ---- Rejection details ----
  'pallet.rejectedBagsLabel': 'Bolsas rechazadas (cuántas bolsas se rechazan)',
  'pallet.rejectionNotesLabel': 'Notas / motivo del rechazo',
  'pallet.rejectionNotesPlaceholder':
    'Describa por qué se rechazaron estas bolsas (p. ej. daño de montacargas, agujeros de roedor, daño por agua)...',

  // ---- Pallet footer ----
  'pallet.totalOnPallet': 'Total en esta tarima',
  'pallet.bagsCountOne': '{count} bolsa',
  'pallet.bagsCount': '{count} bolsas',
  'pallet.piecesCountOne': '{count} pieza',
  'pallet.piecesCount': '{count} piezas',
  'pallet.errLpnRequired': 'El número de LPN es obligatorio.',
  'pallet.errBatchRequired': 'Todas las secciones de lote requieren un código de lote.',
  'pallet.confirmRemove': '¿Quitar esta tarima? Se perderán las fotos y los datos.',
  'pallet.removePallet': 'Quitar tarima',
  'pallet.addToLoad': '✓ Agregar a la carga',
  'pallet.backToInvestigation': '← Volver a la investigación',
  'pallet.backToLoad': '← Volver a la carga',

  // ---- Running tally header ----
  'tally.complete': 'Completo',
  'tally.totalByUnit': 'Totales por unidad',
  'tally.barComplete': '✓ Completo',
  'tally.barOver': 'Excedente de {count}',
  'tally.barNeeded': '{count} requeridas',
  'tally.barMore': '{count} más',
  'tally.batchesComplete': '{complete} de {total} lotes completos',
  'tally.orderFlagged': 'Orden marcada — problema de cantidad',
  'tally.showBatches': 'Mostrar {count} lotes',
  'tally.hideBatches': 'Ocultar detalles de lotes',

  // ---- Inspection workspace: header ----
  'workspace.palletsCount': '{count} tarimas',
  'workspace.palletCountOne': '{count} tarima',
  'workspace.deliveryCountOne': '{count} entrega',
  'workspace.deliveryCountMany': '{count} entregas',
  'workspace.stopCountOne': '{count} parada',
  'workspace.stopCountMany': '{count} paradas',
  'workspace.staging': 'Preparación: {location}',
  'workspace.reviewProgress': 'Revisar progreso',
  'workspace.archive': 'Archivar',
  'workspace.archiveTitle': '¿Archivar esta inspección?',
  'workspace.home': '← Inicio',
  'workspace.saveAndExit': 'Guardar y salir',
  'workspace.deletePallet': 'Eliminar tarima',
  'workspace.deletePalletTitle': '¿Eliminar tarima n.º {number}?',
  'workspace.deletePalletMessage':
    '¿Seguro que desea eliminar la tarima n.º {number}? Se eliminarán {bags} bolsas y {photos} fotos.',
  'workspace.palletDeletedToast': 'Tarima n.º {number} eliminada',
  'pallet.confirmRemoveTitle': '¿Eliminar esta tarima?',
  'workspace.confirmArchive':
    '¿Seguro que desea archivar esta inspección? Se ocultará de la lista activa.',
  'workspace.viewBannerPre': 'Esta inspección está completa y abierta en',
  'workspace.viewBannerMode': 'modo de vista',
  'workspace.viewBannerPost':
    '. Toque una tarima para revisarla o cambie a Editar en la esquina para hacer cambios.',

  // ---- Handoff ----
  'workspace.scanningAs': 'Escaneando como',
  'workspace.unknownInspector': 'Desconocido',
  'workspace.handoffCountOne': '{count} relevo en esta carga',
  'workspace.handoffCountMany': '{count} relevos en esta carga',
  'workspace.handoffButton': '⇄ Pasar a otro inspector',
  'workspace.handoffHistory': 'Historial de relevos',
  'workspace.handoffStarted': 'inicio',
  'workspace.handoffCompleted': '{name} completó las tarimas {pallets}',
  'workspace.handoffTitle': 'Pasar a otro inspector',
  'workspace.handoffSubPre':
    'A partir de ahora, las tarimas nuevas se asignarán al nuevo inspector. Las tarimas anteriores siguen atribuidas a',
  'workspace.newInspector': 'Nuevo inspector',
  'workspace.selectInspector': 'Seleccione inspector…',
  'workspace.confirmHandoff': 'Confirmar relevo',

  // ---- Add pallet ----
  'workspace.scanNextPallet': 'Escanear siguiente tarima',
  'workspace.pickDeliveryType': 'Elija entrega y tipo de tarima',
  'workspace.pickStopDeliveryType': 'Elija parada, entrega y tipo de tarima',
  'workspace.modalSub': 'Elija parada, entrega y tipo de tarima.',
  'workspace.stopFieldLabel': 'Parada',
  'workspace.deliveryFieldLabel': 'Entrega',
  'workspace.howManyBatches': '¿Cuántos lotes hay en esta tarima?',
  'workspace.cancel': 'Cancelar',
  'workspace.startScanning': 'Comenzar escaneo →',

  // ---- Stops, deliveries and pallet cards ----
  'workspace.noDeliveriesTitle': 'No hay entregas en esta carga',
  'workspace.noDeliveriesSub':
    'Regrese a verificar el BOL y agregue al menos una entrega antes de escanear tarimas.',
  'workspace.backToVerify': 'Volver a verificar',
  'workspace.returnedPallets': 'Tarimas devueltas',
  'workspace.noPalletsYet': 'Aún no se han escaneado tarimas.',
  'workspace.noPalletsForDelivery': 'Aún no se han escaneado tarimas para esta entrega.',
  'workspace.unassigned': 'Sin asignar',
  'workspace.stopLabel': 'Parada {number}',
  'workspace.deliveryLabel': 'Entrega {number}',
  'workspace.palletLabel': 'Tarima {number}',
  'workspace.scannedBy': 'Escaneada por {name}',
  'workspace.bagsUnit': 'bolsas',
  'workspace.flagged': '⚑ Marcada',

  // ---- Warnings and footer ----
  'workspace.warnFullBagCount':
    'La tarima #{pallet} está marcada como tarima completa de bolsas pero tiene {count} bolsas. Debe contener exactamente 60 bolsas.',
  'workspace.warnSplitBatch':
    'El lote "{batch}" está dividido en varias tarimas parciales (Tarimas #{pallets}). Se requiere solo una tarima parcial por código de lote.',
  'workspace.attentionRequired': 'Atención requerida',
  'workspace.viewSummary': 'Ver resumen →',
  'workspace.completeInspection': 'Completar inspección →',
  'workspace.moreBagsOne': '{count} bolsa más por escanear',
  'workspace.moreBagsMany': '{count} bolsas más por escanear',
};
