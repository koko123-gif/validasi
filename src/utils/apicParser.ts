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
    const vlanMatch = line.match(/vlan-(\d+)/i);
    if (vlanMatch) {
      vlan = vlanMatch[1];
    }

    const nodeMatch = line.match(/Node\s*\n\s*(\d+)\s+(\d+)/);
    if (nodeMatch) {
      const node1 = parseInt(nodeMatch[1]);
      if (node1 >= 400) {
        pod = 'pod-2';
      } else if (node1 >= 300) {
        pod = 'pod-1';
      }
    }

    const vpcMatch = line.match(/vpc\s+([\d-]+-VPC-[\d-]+-PG)/i);
    if (vpcMatch) {
      pathSet.add(vpcMatch[1]);
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
    // Match protpaths (VPC)
    let dnMatch = line.match(/dn\s*:\s*uni\/tn-[^\/]+\/ap-[^\/]+\/epg-([^\/]+)\/rspathAtt-\[topology\/(pod-\d+\/protpaths-[\d-]+\/pathep-\[[^\]]+\])\]/i);

    // Match single paths (non-VPC)
    if (!dnMatch) {
      dnMatch = line.match(/dn\s*:\s*uni\/tn-[^\/]+\/ap-[^\/]+\/epg-([^\/]+)\/rspathAtt-\[topology\/(pod-\d+\/paths-[\d]+\/pathep-\[[^\]]+\])\]/i);
    }

    if (dnMatch) {
      const epg = dnMatch[1];
      const fullPath = dnMatch[2];

      const vlanMatch = epg.match(/VLAN(\d+)/i);
      const vlan = vlanMatch ? vlanMatch[1] : '';

      const pathMatch = fullPath.match(/pathep-\[([^\]]+)\]/);
      const pathName = pathMatch ? pathMatch[1] : '';

      if (vlan && pathName) {
        console.log(`Parsed moquery: VLAN=${vlan}, Path=${pathName}, EPG=${epg}`);
        attachments.push({
          vlan,
          epg,
          path: pathName,
          fullPath
        });
      }
    }
  }

  console.log('Total parsed moquery attachments:', attachments.length);
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

  // Debug logging
  console.log('Endpoint VLAN:', endpointData.vlan);
  console.log('Endpoint Paths:', endpointData.paths);
  console.log('Filtered Attachments for VLAN:', filteredAttachments);
  console.log('Allowed Paths Set:', Array.from(allowedPaths));

  // Validasi setiap path dari endpoint
  for (const path of endpointData.paths) {
    const normalizedPath = normalizePathName(path);
    // Path dianggap "allowed" jika ada di kedua input (endpoint DAN moquery)
    const isAllowed = allowedPaths.has(normalizedPath);

    console.log(`Checking path: "${path}" (normalized: "${normalizedPath}") -> ${isAllowed ? 'ALLOWED' : 'NOT ALLOWED'}`);

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

  const rows = notAllowedPaths.map(vpcPath => {
    let fullPath = pathMap.get(vpcPath);

    if (!fullPath) {
      const protpathsMatch = vpcPath.match(/(\d+)-(\d+)-VPC/);
      if (protpathsMatch) {
        fullPath = `${endpointData.pod}/protpaths-${protpathsMatch[1]}-${protpathsMatch[2]}/pathep-[${vpcPath}]`;
      } else {
        fullPath = `${endpointData.pod}/protpaths-XXX-XXX/pathep-[${vpcPath}]`;
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
