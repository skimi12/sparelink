import test from "node:test";
import assert from "node:assert/strict";
import { previewFee } from "../lib/sparelink/fee-preview.mjs";

for (const [raw, fee, total, min] of [["50000",7500,57500,false],["10000",5000,15000,true],["5000",5000,10000,true],["33326",5000,38326,true],["33334",5001,38335,false],["10000000",1500000,11500000,false],["1",5000,5001,true]]) {
  test("hypothetical fee: "+raw, () => {
    const v = previewFee(raw);
    assert.equal(v?.fee, fee);
    assert.equal(v?.combined, total);
    assert.equal(v?.minimumApplied, min);
  });
}
for (const raw of ["","0","-1","1.5","1e5","50,000","10000001"," 5000","５０","NaN",null,5000]) {
  test("invalid amount: "+String(raw), () => assert.equal(previewFee(raw), null));
}
test("minimum fee may equal the part subtotal", () => {
  assert.equal(previewFee("5000").effectivePercent, 100);
});
