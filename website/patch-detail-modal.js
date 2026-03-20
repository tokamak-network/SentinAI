const fs = require('fs');
const file = 'src/app/marketplace/operators/[address]/page.tsx';
let src = fs.readFileSync(file, 'utf8');

src = src.replace(
  "<PurchaseModal\n          agentId={address}",
  "<PurchaseModal\n          agentId={address}\n          operatorAddress={address}"
);

fs.writeFileSync(file, src);
