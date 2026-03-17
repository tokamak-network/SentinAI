import { getRegistrationStatus } from '@/lib/agent-marketplace/registration-status';
import { RegistrationWizard } from '@/components/marketplace/RegistrationWizard';

export default async function RegistryPage() {
  const registrationStatus = await getRegistrationStatus();

  return (
    <div style={{ padding: '0' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          ERC8004 Registry
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          Register your agent on the Sepolia ERC8004 registry for marketplace discovery.
        </p>
      </div>

      <RegistrationWizard initialStatus={registrationStatus} />
    </div>
  );
}
