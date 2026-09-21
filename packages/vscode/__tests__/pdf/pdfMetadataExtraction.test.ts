/**
 * Unit tests for the metadata heuristics that decide which of a PDF's
 * competing sources (Info dictionary, XMP packet, link annotations, text
 * layer) may be trusted for a given field.
 */

import {
  buildCiteKey,
  detectIdentifier,
  isSparseText,
  looksLikeNaturalText,
  metadataFromXmp,
  timestampsAreTrustworthy,
  usableTitle,
  yearFromText,
} from '@labshelf/core';

describe('usableTitle', () => {
  it('rejects a filename left in Info.Title by the producer', () => {
    expect(usableTitle('15200863156991 1..46 - 28383.pdf')).toBeUndefined();
    expect(usableTitle('Microsoft Word - manuscript_final.doc')).toBeUndefined();
  });

  it('rejects the window title a viewer stamps on a page printed from it', () => {
    expect(usableTitle('PDF.js viewer')).toBeUndefined();
    expect(usableTitle('Adobe Acrobat Reader')).toBeUndefined();
    expect(usableTitle('Viewer-Based Rendering of Large PDF Archives')).toBeDefined();
  });

  it('rejects placeholder and numeric job names', () => {
    expect(usableTitle('Untitled')).toBeUndefined();
    expect(usableTitle('No Job Name')).toBeUndefined();
    expect(usableTitle('1520-0863 12 3 4455')).toBeUndefined();
  });

  it('rejects a long unbroken slug', () => {
    expect(usableTitle('a'.repeat(60))).toBeUndefined();
  });

  it('keeps a genuine paper title', () => {
    const title = 'Attention Is All You Need';
    expect(usableTitle(title)).toBe(title);
  });
});

describe('looksLikeNaturalText', () => {
  it('rejects text recovered from fonts with a broken ToUnicode map', () => {
    // Real page-1 output from a PDF whose embedded subset fonts scramble the
    // character map; every "word" is unreadable.
    const scrambled = (
      'WrnE ynEENFCnAMNAyN wUGNVBFN xNETNUNL NzH VLNEF FGwGF BK wy HT ' +
      'ZNCwEGVNAG BO XRBNAPRANNERAP kARINEFRGL BO YwUROBEARw XNETNUNL ' +
      'kARGNz iGwGNFW jt YQwA iyQBBU BO fHxURytNwUGQ twEIwEz kARINEFRGL'
    ).repeat(3);

    expect(looksLikeNaturalText(scrambled)).toBe(false);
  });

  it('accepts ordinary English and Portuguese prose', () => {
    const english =
      'The dominant sequence transduction models are based on complex recurrent ' +
      'or convolutional neural networks in an encoder decoder configuration and ' +
      'we propose a new simple network architecture based on attention mechanisms ' +
      'that dispenses with recurrence and convolutions entirely for these tasks.';
    const portuguese =
      'Este trabalho apresenta uma analise dos dados de expressao genica que foram ' +
      'obtidos para as amostras do estudo com o objetivo de avaliar os efeitos da ' +
      'intervencao e para que os resultados possam ser comparados com os controles.';

    expect(looksLikeNaturalText(english)).toBe(true);
    expect(looksLikeNaturalText(portuguese)).toBe(true);
  });

  it('does not reject documents with too little text to judge', () => {
    expect(looksLikeNaturalText('Xyz Qrs')).toBe(true);
  });
});

describe('detectIdentifier', () => {
  it('reads a DOI from a link annotation when the text layer is unusable', () => {
    const identifier = detectIdentifier({}, 'WrnE ynEENFCnAMNAyN', [
      'https://doi.org/10.1371/journal.pone.0173461',
    ]);

    expect(identifier).toEqual({ type: 'doi', value: '10.1371/journal.pone.0173461' });
  });

  it('prefers a labelled DOI over an earlier bibliography match', () => {
    const text = 'References 10.9999/old.reference ... doi:10.1038/nature12373';

    expect(detectIdentifier({}, text)).toEqual({ type: 'doi', value: '10.1038/nature12373' });
  });

  it('recovers a DOI split across text items', () => {
    expect(detectIdentifier({}, 'https://doi.org/10.1038/ nature12373')).toEqual({
      type: 'doi',
      value: '10.1038/nature12373',
    });
  });

  it('strips trailing punctuation from a DOI', () => {
    expect(detectIdentifier({}, 'doi:10.1038/nature12373.')).toEqual({
      type: 'doi',
      value: '10.1038/nature12373',
    });
  });

  it('does not mistake an arbitrary decimal number for an arXiv id', () => {
    // A page range, a version string and a measurement all match `dddd.dddd`.
    expect(detectIdentifier({}, 'pages 1706.03762 of volume 12')).toBeUndefined();
    expect(detectIdentifier({}, 'measured 2017.1234 units')).toBeUndefined();
  });

  it('accepts an arXiv id with explicit context', () => {
    expect(detectIdentifier({}, 'arXiv:1706.03762v7')).toEqual({
      type: 'arxiv',
      value: '1706.03762',
    });
    expect(detectIdentifier({}, '', ['https://arxiv.org/abs/1706.03762'])).toEqual({
      type: 'arxiv',
      value: '1706.03762',
    });
  });
});

describe('metadataFromXmp', () => {
  it('maps a publisher XMP packet onto bibliographic fields', () => {
    const xmp = {
      getAll: () => ({
        'dc:title': 'A stillbirth calculator',
        'dc:creator': 'Amanda S. Trudell; Methodius G. Tuuli',
        'prism:publicationName': 'PLOS ONE',
        'prism:volume': '12',
        'prism:number': '3',
        'prism:startingPage': 'e0173461',
        'prism:doi': '10.1371/journal.pone.0173461',
        'prism:issn': '1932-6203',
        'prism:coverDate': '2017-03-08',
        'dc:language': 'en',
      }),
    };

    expect(metadataFromXmp(xmp)).toMatchObject({
      title: 'A stillbirth calculator',
      authors: ['Amanda S. Trudell', 'Methodius G. Tuuli'],
      journal: 'PLOS ONE',
      volume: '12',
      issue: '3',
      pages: 'e0173461',
      doi: '10.1371/journal.pone.0173461',
      issn: '1932-6203',
      year: 2017,
      language: 'en',
    });
  });

  it('unwraps a DOI stored as a doi.org URL in dc:identifier', () => {
    const xmp = { getAll: () => ({ 'dc:identifier': 'https://doi.org/10.1038/nature12373' }) };

    expect(metadataFromXmp(xmp)?.doi).toBe('10.1038/nature12373');
  });

  it('reads a Map and language-alternative values', () => {
    const xmp = {
      getAll: () => new Map<string, unknown>([['dc:title', { 'x-default': 'Mapped Title' }]]),
    };

    expect(metadataFromXmp(xmp)?.title).toBe('Mapped Title');
  });

  it('returns undefined when there is no XMP packet', () => {
    expect(metadataFromXmp(undefined)).toBeUndefined();
    expect(metadataFromXmp({ getAll: () => ({}) })).toBeUndefined();
  });
});

describe('yearFromText', () => {
  it('reads the year from a copyright line', () => {
    expect(yearFromText('Copyright 2016 Altemose et al. All rights reserved.')).toBe(2016);
  });

  it('reads the year from a publication date line', () => {
    expect(yearFromText('Received: 13 May 2016 / Accepted: 2 October 2016')).toBe(2016);
  });

  it('returns undefined when no year is stated', () => {
    expect(yearFromText('A paper about proteins with no dates at all')).toBeUndefined();
  });
});

describe('timestampsAreTrustworthy', () => {
  it('distrusts timestamps written by a print-to-PDF re-save', () => {
    expect(
      timestampsAreTrustworthy({
        Producer: 'macOS Versão 27.0 (Compilação 26A428) Quartz PDFContext',
        Creator: 'Firefox Developer Edition',
      }),
    ).toBe(false);
  });

  it('trusts timestamps from a typesetting pipeline', () => {
    expect(timestampsAreTrustworthy({ Producer: 'pdfTeX-1.40.21', Creator: 'LaTeX' })).toBe(true);
  });
});

describe('buildCiteKey', () => {
  it('prefers the identifier, then the title, and only then the file stem', () => {
    expect(buildCiteKey('artigo-1', 'Attention Is All You Need', 2017, '10.1000/xyz')).toBe('101000xyz2017');
    expect(buildCiteKey('artigo-1', 'Attention Is All You Need', 2017)).toBe('attentionisallyouneed2017');
    expect(buildCiteKey('artigo-1', '', undefined)).toBe('artigo1');
  });

  it('folds accents instead of dropping the letter, and caps a long title', () => {
    expect(buildCiteKey('x', 'Análise de Proteínas')).toBe('analisedeproteinas');
    expect(buildCiteKey('x', 'word '.repeat(40)).length).toBe(48);
  });
});

describe('isSparseText', () => {
  const STAMP =
    'Downloaded 12/25/12 to 150.135.135.70. Redistribution subject to SIAM license or copyright; see http://www.siam.org/journals/ojsa.php';

  it('treats a stamp repeated on every page as no text at all', () => {
    // Joined, three copies exceed the word floor; no single page does.
    expect(isSparseText([STAMP, STAMP, STAMP])).toBe(true);
    expect(isSparseText([])).toBe(true);
  });

  it('accepts a layer in which any page reads like a page', () => {
    const page = 'We study the behaviour of graph search on geometric inputs. '.repeat(8);
    expect(isSparseText([STAMP, page])).toBe(false);
  });
});
