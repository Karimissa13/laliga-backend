import { InventoryProgramme } from '../../database/entities/enums';

/** The one practice item a fresh store starts with — follow it to learn the flow, then add the real stock. */
export const TEST_ITEM = {
  name: 'TEST ITEM — practice (deactivate when done)', programme: InventoryProgramme.LALIGA, category: 'Test',
  itemCode: 'LL-TEST', unit: 'Pcs', condition: 'New', notes: 'Use this to practise stock in / out / stock take.',
  sizes: [{ size: 'M', openingQty: 10 }],
};

