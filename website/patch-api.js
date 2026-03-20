const fs = require('fs');
const file = 'src/app/api/marketplace/settle/route.ts';
let src = fs.readFileSync(file, 'utf8');

src = src.replace(
  "const { paymentAuthorization, requirements } = body;",
  "const { paymentAuthorization, requirements, operatorAddress } = body;"
);

src = src.replace(
  "amount: requirements.amount,",
  "amount: requirements.amount,\n      operator: operatorAddress,\n      buyer: requirements.buyer || 'unknown',"
);

fs.writeFileSync(file, src);
