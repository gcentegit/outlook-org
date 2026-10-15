import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CERT_EXPIRY_SYNC_ID } from '@clasificador/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseCertificateExpiry, recordCertificateExpiry } from './cert-expiry';

// Certificado autofirmado de prueba (sin clave) que caduca el 2036-10-12T18:18:55Z.
const CERT = `-----BEGIN CERTIFICATE-----
MIIBkDCCATWgAwIBAgIUd/W9GgtthH7stJKI66kWKjfrGmwwCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwScHJ1ZWJhLmVqZW1wbG8uY29tMB4XDTI2MTAxNTE4MTg1NVoX
DTM2MTAxMjE4MTg1NVowHTEbMBkGA1UEAwwScHJ1ZWJhLmVqZW1wbG8uY29tMFkw
EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEK2HV/sKAL+u0kPPik/GA+8K+sCh+v2DN
hmXpNNx8gSRy0821nTaM1WfUZD4psGiNxgHjSDPl3Ri1tyNBotGTgaNTMFEwHQYD
VR0OBBYEFDLRXBDziToZIHUYwIz3IlMgXkaRMB8GA1UdIwQYMBaAFDLRXBDziToZ
IHUYwIz3IlMgXkaRMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSQAwRgIh
AMnMUWv4qykn7uq8ivBlPb7SBId2TOkTuD+8egWxeTyGAiEAtr+D3wE9MyaLHi8E
lwQGhPC8kLJCI26XNo21T+HNjyc=
-----END CERTIFICATE-----
`;
// El PEM real lleva antes la clave privada.
const PEM = `-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n${CERT}`;
const EXPIRES = new Date('2036-10-12T18:18:55Z');

describe('parseCertificateExpiry', () => {
  it('lee la caducidad del certificado aunque el PEM lleve la clave delante', () => {
    expect(parseCertificateExpiry(PEM)).toEqual(EXPIRES);
  });

  it('falla si no hay certificado', () => {
    expect(() => parseCertificateExpiry('nada')).toThrow(/ningún certificado/);
  });
});

describe('recordCertificateExpiry', () => {
  let dir: string | null = null;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('guarda la caducidad en SyncState', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cert-'));
    const path = join(dir, 'cert.pem');
    await writeFile(path, PEM);
    const upsert = vi.fn().mockResolvedValue({});
    const result = await recordCertificateExpiry({ syncState: { upsert } } as never, path);
    expect(result).toEqual(EXPIRES);
    expect(upsert).toHaveBeenCalledWith({
      where: { id: CERT_EXPIRY_SYNC_ID },
      create: { id: CERT_EXPIRY_SYNC_ID, lastSyncAt: EXPIRES },
      update: { lastSyncAt: EXPIRES },
    });
  });

  it('devuelve null y no lanza si el fichero no se puede leer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const upsert = vi.fn();
    const result = await recordCertificateExpiry({ syncState: { upsert } } as never, '/no/existe');
    expect(result).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});
