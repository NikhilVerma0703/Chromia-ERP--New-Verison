import { stockedOnDay, stockyardToday } from '@/lib/chromia/constants/stock-outcomes';
import { toDateInput, toTimeInput } from '@/lib/chromia/operator-register';
import { toPlantDateInput } from '@/lib/chromia/plant-time';
import { manualRemark } from '@/lib/chromia/slab-remarks';
import { loadSlabRecord } from '@/lib/chromia/server/repositories/slab-record-repository';
import {
  loadBaseMaterialNames,
  loadDesignFileNames,
  loadRecentBatchNos,
} from '@/lib/chromia/server/services/operator-service';
import { loadStockyardPlace } from '@/lib/chromia/server/services/stockyard-edit-service';

/**
 * Everything the Stockyard and Approved Slabs Edit forms open with: the slab
 * as it is saved, and where the Stockyard has it. Null when there is no such
 * slab.
 */
export async function loadSlabEditProps(slabId: string) {
  const [record, baseMaterials, fileNames, batchNos] = await Promise.all([
    loadSlabRecord(slabId),
    loadBaseMaterialNames(),
    loadDesignFileNames(),
    loadRecentBatchNos(),
  ]);
  if (!record) return null;
  const { entry, place } = await loadStockyardPlace(slabId);

  return {
    record,
    props: {
      slabId: record.id,
      details: {
        productionDate: toDateInput(record.receivedDate),
        batchNo: record.batchNo,
        slabNo: record.slabNo,
        baseMaterial: record.baseMaterial,
        fileName: record.designFileName,
        thicknessCm: record.thicknessCm === null ? '' : String(record.thicknessCm),
        inTime: record.inTime ? toTimeInput(record.inTime) : '',
      },
      qc: {
        grade: record.currentGrade ?? '',
        disposition: record.currentDisposition ?? '',
        remarks: manualRemark(record.remarks, record.currentDisposition) ?? '',
      },
      editable: place !== null,
      outcome: place ?? '',
      outcomeDate: place && place !== 'IN_STOCK' && entry?.releasedAt ? toPlantDateInput(entry.releasedAt) : '',
      stockedOn: stockedOnDay(entry?.stockDate) ?? '',
      today: stockyardToday(),
      baseMaterials,
      fileNames,
      batchNos,
    },
  };
}
