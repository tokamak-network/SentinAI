const fs = require('fs');
const file = 'src/components/PurchaseModal.tsx';
let src = fs.readFileSync(file, 'utf8');

src = src.replace(
  "interface PurchaseModalProps {",
  "interface PurchaseModalProps {\n  operatorAddress?: string;"
);

src = src.replace(
  "export default function PurchaseModal({ agentId, agentName, endpoint, onClose }: PurchaseModalProps) {",
  "export default function PurchaseModal({ agentId, operatorAddress, agentName, endpoint, onClose }: PurchaseModalProps) {"
);

src = src.replace(
  "body: JSON.stringify({ paymentAuthorization: signature, requirements: modalState.paymentRequirements }),",
  "body: JSON.stringify({ paymentAuthorization: signature, requirements: modalState.paymentRequirements, operatorAddress: operatorAddress || agentId }),"
);

fs.writeFileSync(file, src);
