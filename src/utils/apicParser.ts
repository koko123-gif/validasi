export interface EndpointData {
  vlan: string;
  ip: string;
  paths: string[];
  pod: string;
}

export interface PathAttachment {
  vlan: string;
  epg: string;
  path: string;
  fullPath: string;
}

export interface ValidationResult {
  path: string;
  hasActiveEndpoint: boolean;
  isVlanAllowed: boolean;
  status: 'allowed' | 'not_allowed';
}

export function parseEndpointOutput(input: string): EndpointData | null {
  const lines = input.trim().split('\n');

  let vlan = '';
  let pod = '';
  const pathSet = new Set<string>();

  for (const line of lines) {
    // Extract VLAN
    const vlanMatch = line.match(/vlan-(\d+)/i);
    if (vlanMatch) {
      vlan = vlanMatch[1];
    }

    // Extract Node to determine pod
    const nodeMatch = line.match(/Node\s*\n\s*(\d+)\s+(\d+)/);
    if (nodeMatch) {
      const node1 = parseInt(nodeMatch[1]);
      if (node1 >= 400) {
        pod = 'pod-2';
      } else if (node1 >= 300) {
        pod = 'pod-1';
      } else if (node1 >= 200) {
        pod = 'pod-2';
      } else {
        pod = 'pod-1';
      }
    }

    // Extract VPC paths - support multiple formats
    // Format 1: vpc 425-426-VPC-31-32-PG
    let vpcMatch = line.match(/vpc\s+([\d-]+-VPC-[\d-]+-PG)/i);
    if (vpcMatch) {
      pathSet.add(vpcMatch[1]);
    }

    // Format 2: VPC path without "vpc" prefix
    if (!vpcMatch) {
      vpcMatch = line.match(/\b([\d-]+-[\d-]+-VPC-[\d-]+-[\d-]+-PG)\b/i);
      if (vpcMatch) {
        pathSet.add(vpcMatch[1]);
      }
    }
  }

  if (vlan && pathSet.size > 0) {
    return {
      vlan,
      ip: '',
      paths: Array.from(pathSet),
      pod: pod || 'pod-1'
    };
  }

  return null;
}

export function parseMoqueryOutput(input: string): PathAttachment[] {
  const lines = input.trim().split('\n');
  const attachments: PathAttachment[] = [];

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Match protpaths (VPC)
    let dnMatch = line.match(/dn\s*:\s*uni\/tn-[^\/]+\/ap-[^\/]+\/epg-([^\/]+)\/rspathAtt-\[topology\/(pod-\d+\/protpaths-[\d-]+\/pathep-\[([^\]]+)\])\]/i);

    let isVpc = true;
    // Match single paths (non-VPC)
    if (!dnMatch) {
      dnMatch = line.match(/dn\s*:\s*uni\/tn-[^\/]+\/ap-[^\/]+\/epg-([^\/]+)\/rspathAtt-\[topology\/(pod-\d+\/paths-[\d]+\/pathep-\[([^\]]+)\])\]/i);
      isVpc = false;
    }

    if (dnMatch) {
      const epg = dnMatch[1];
      const fullPath = dnMatch[2];
      const pathName = dnMatch[3]; // Captured path name directly

      // Extract VLAN from EPG name
      const vlanMatch = epg.match(/VLAN(\d+)/i);
      const vlan = vlanMatch ? vlanMatch[1] : '';

      if (vlan && pathName) {
        attachments.push({
          vlan,
          epg,
          path: pathName,
          fullPath
        });
      }
    }
  }

  return attachments;
}

export function validateVlanAllowances(
  endpointData: EndpointData,
  pathAttachments: PathAttachment[]
): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Buat Set dari path yang ada di moquery dengan VLAN yang sesuai
  const filteredAttachments = pathAttachments.filter(att => att.vlan === endpointData.vlan);
  const allowedPaths = new Set(
    filteredAttachments.map(att => normalizePathName(att.path))
  );

  // Validasi setiap path dari endpoint
  for (const path of endpointData.paths) {
    const normalizedPath = normalizePathName(path);
    // Path dianggap "allowed" jika ada di kedua input (endpoint DAN moquery)
    const isAllowed = allowedPaths.has(normalizedPath);

    results.push({
      path,
      hasActiveEndpoint: true,
      isVlanAllowed: isAllowed,
      status: isAllowed ? 'allowed' : 'not_allowed'
    });
  }

  return results;
}

// Normalisasi nama path untuk memastikan perbandingan yang konsisten
function normalizePathName(path: string): string {
  // Hapus whitespace, kurung siku, dan ubah ke lowercase untuk perbandingan
  return path.trim().replace(/[\[\]]/g, '').toLowerCase();
}

export function generateCSV(
  vlan: string,
  epg: string,
  results: ValidationResult[],
  endpointData: EndpointData,
  pathAttachments: PathAttachment[]
): string {
  const header = 'VLAN,EPG,PATH';

  const notAllowedPaths = results
    .filter(r => r.status === 'not_allowed')
    .map(r => r.path);

  const pathMap = new Map<string, string>();
  for (const attachment of pathAttachments) {
    pathMap.set(attachment.path, attachment.fullPath);
  }

  const rows = notAllowedPaths.map(pathName => {
    let fullPath = '';

    // Check if it's a VPC path (format: XXX-YYY-VPC-...)
    const vpcMatch = pathName.match(/(\d+)-(\d+)-VPC/);
    if (vpcMatch) {
      const node1 = vpcMatch[1];
      const node2 = vpcMatch[2];
      fullPath = `${endpointData.pod}/protpaths-${node1}-${node2}/pathep-[${pathName}]`;
    } else {
      // Single path (format: node-port)
      const singleMatch = pathName.match(/^(\d+)[-\/]/);
      if (singleMatch) {
        const node = singleMatch[1];
        fullPath = `${endpointData.pod}/paths-${node}/pathep-[${pathName}]`;
      } else {
        // Fallback
        fullPath = `${endpointData.pod}/paths-XXX/pathep-[${pathName}]`;
      }
    }

    return `${vlan},${epg},${fullPath}`;
  });

  return header + '\n' + rows.join('\n');
}

export function extractPathName(path: string): string {
  return path;
}

export function extractVlanFromEpg(epgName: string): string {
  const vlanMatch = epgName.match(/VLAN(\d+)/i);
  return vlanMatch ? vlanMatch[1] : '';
}
