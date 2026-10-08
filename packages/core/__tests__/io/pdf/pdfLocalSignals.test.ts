/**
 * Unit tests for the offline last-resort signals: the abstract and keyword
 * lines printed in a paper's front matter, the journal name carried by a
 * running head, and the publisher keys stamped into the Info dictionary.
 */

import {
  abstractFromText,
  describeFallback,
  journalFromRunningHead,
  keywordsFromText,
  publisherMetadataFromInfo,
  titleFromPlainText,
} from '@labshelf/core';

const ABSTRACT_BODY =
  'Deeper neural networks are more difficult to train. We present a residual ' +
  'learning framework to ease the training of networks that are substantially ' +
  'deeper than those used previously. We explicitly reformulate the layers as ' +
  'learning residual functions with reference to the layer inputs, instead of ' +
  'learning unreferenced functions.';

const FRONT_MATTER = [
  'Deep Residual Learning for Image Recognition',
  'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun',
  'Microsoft Research',
  'Abstract',
  ABSTRACT_BODY,
  '1. Introduction',
  'Deep convolutional neural networks have led to a series of breakthroughs.',
].join('\n');

describe('abstractFromText', () => {
  it('reads the abstract from a paper front matter and stops at the next section', () => {
    const abstract = abstractFromText(FRONT_MATTER);

    expect(abstract).toBe(ABSTRACT_BODY);
    expect(abstract).not.toContain('Introduction');
  });

  it('tolerates the delimiters publishers print after the heading', () => {
    expect(abstractFromText(`ABSTRACT—${ABSTRACT_BODY}\nKeywords: residual learning`)).toBe(ABSTRACT_BODY);
    expect(abstractFromText(`Resumo: ${ABSTRACT_BODY}\n1 Introdução\nTexto.`)).toBe(ABSTRACT_BODY);
  });

  it('collapses the line breaks the text layer leaves inside the abstract', () => {
    const wrapped = 'Abstract\n' + ABSTRACT_BODY.replace(/ /g, '\n') + '\nIntroduction';

    expect(abstractFromText(wrapped)).toBe(ABSTRACT_BODY);
  });

  it('rejects a run too short to be an abstract', () => {
    expect(abstractFromText('Abstract. See the abstract online.')).toBeUndefined();
  });

  it('returns undefined when the front matter has no abstract heading', () => {
    expect(abstractFromText('A short note with no abstract heading at all.')).toBeUndefined();
    expect(abstractFromText('')).toBeUndefined();
  });
});

describe('keywordsFromText', () => {
  it('splits a keyword line on commas, semicolons and middle dots', () => {
    const text =
      'Keywords: machine learning, neural networks; attention mechanisms · transformers\n' +
      '1 Introduction\nDeep convolutional neural networks have led to breakthroughs.';

    expect(keywordsFromText(text)).toEqual([
      'machine learning',
      'neural networks',
      'attention mechanisms',
      'transformers',
    ]);
  });

  it('reads a Portuguese keyword line', () => {
    const text =
      'Palavras-chave: genômica, dobramento de proteínas, simulação molecular\n\n' +
      '1 Introdução\nEste trabalho apresenta uma análise dos dados.';

    expect(keywordsFromText(text)).toEqual([
      'genômica',
      'dobramento de proteínas',
      'simulação molecular',
    ]);
  });

  it('reads the labels used by IEEE and Springer', () => {
    expect(keywordsFromText('Index Terms—image segmentation, deep learning.')).toEqual([
      'image segmentation',
      'deep learning',
    ]);
    expect(keywordsFromText('Key words: proteomics; mass spectrometry')).toEqual([
      'proteomics',
      'mass spectrometry',
    ]);
  });

  it('dedupes case-insensitively and caps the list at fifteen entries', () => {
    expect(keywordsFromText('Keywords: Genomics, genomics, GENOMICS')).toEqual(['Genomics']);

    const many = Array.from({ length: 20 }, (_, index) => `topic ${index}`).join(', ');
    expect(keywordsFromText(`Keywords: ${many}`)).toHaveLength(15);
  });

  it('drops entries too short or too long to be keywords', () => {
    const tooLong = 'x'.repeat(61);

    expect(keywordsFromText(`Keywords: a, ok, ${tooLong}`)).toEqual(['ok']);
  });

  it('returns an empty array when there is no keyword line', () => {
    expect(keywordsFromText('An abstract with no keyword line below it.')).toEqual([]);
    expect(keywordsFromText('')).toEqual([]);
  });
});

describe('journalFromRunningHead', () => {
  it('finds the journal name repeated in the running head', () => {
    const pages = [
      'Journal of Molecular Biology | 3 of 46\nResidue contacts were computed for every frame.',
      'Journal of Molecular Biology | 4 of 46\nThe resulting distributions are shown in Figure 2.',
      '5\nJournal of Molecular Biology\nWe then compared the two folding pathways.',
    ];

    expect(journalFromRunningHead(pages)).toBe('Journal of Molecular Biology');
  });

  it('ignores bare page numbers and lines that are mostly digits', () => {
    const pages = [
      'Page 1\n2018;57(12):3120-3135\nAlpha beta gamma delta',
      'Page 2\n2018;57(12):3120-3135\nEpsilon zeta eta theta',
    ];

    expect(journalFromRunningHead(pages)).toBeUndefined();
  });

  it('returns undefined when no line repeats across pages', () => {
    expect(journalFromRunningHead(['A single page with nothing repeated on it.'])).toBeUndefined();
    expect(journalFromRunningHead([])).toBeUndefined();
  });
});

describe('publisherMetadataFromInfo', () => {
  it('harvests the non-standard keys a publisher stamps into the Info dictionary', () => {
    const info = {
      'WPS-ARTICLEDOI': '10.1002/anie.201712345',
      JournalTitle: 'Angewandte Chemie International Edition',
      VolumeNum: '57',
      IssueNum: '12',
      FirstPage: '3120',
      LastPage: '3135',
      ISSN: '1433-7851',
      Publisher: 'Wiley-VCH Verlag GmbH',
      Copyright: '© 2018 Wiley-VCH Verlag GmbH & Co. KGaA, Weinheim',
    };

    expect(publisherMetadataFromInfo(info)).toEqual({
      doi: '10.1002/anie.201712345',
      journal: 'Angewandte Chemie International Edition',
      volume: '57',
      issue: '12',
      pages: '3120-3135',
      issn: '1433-7851',
      publisher: 'Wiley-VCH Verlag GmbH',
      year: 2018,
    });
  });

  it('unwraps a prefixed DOI and keeps a lone first page', () => {
    expect(publisherMetadataFromInfo({ doi: 'doi:10.1038/nature12373.', FirstPage: 'e0173461' })).toEqual({
      doi: '10.1038/nature12373',
      pages: 'e0173461',
    });
  });

  it('returns undefined when the dictionary holds nothing bibliographic', () => {
    expect(publisherMetadataFromInfo({ Producer: 'pdfTeX-1.40.21', Creator: 'LaTeX' })).toBeUndefined();
    expect(publisherMetadataFromInfo({ Journal: '   ', Volume: 12 })).toBeUndefined();
    expect(publisherMetadataFromInfo({})).toBeUndefined();
  });
});

describe('describeFallback', () => {
  it('counts the populated fields of a record', () => {
    expect(
      describeFallback({ title: 'Deep Residual Learning', authors: ['Kaiming He'], year: 2016 }),
    ).toBe(3);
  });

  it('ignores empty arrays and blank strings', () => {
    expect(describeFallback({ title: 'A Title', authors: [], journal: '' })).toBe(1);
    expect(describeFallback({})).toBe(0);
  });
});

describe('titleFromPlainText', () => {
  it('joins the title lines that sit directly above the byline', () => {
    const ocr = [
      'PLOS | one',
      'RESEARCH ARTICLE',
      'More than 75 percent decline over 27 years in',
      'total flying insect biomass in protected areas',
      "Caspar A. Hallmann'*, Martin Sorg?, Eelke Jongejans', Henk Siepel",
    ].join('\n');

    expect(titleFromPlainText(ocr)).toBe(
      'More than 75 percent decline over 27 years in total flying insect biomass in protected areas',
    );
  });

  it('skips a notice printed above the title and the OCR specks around it', () => {
    const ocr = [
      'Provided proper attribution is provided, Google hereby grants permission to',
      'reproduce the tables and figures in this paper solely for use in journalistic or',
      'scholarly works.',
      'FE',
      'Attention Is All You Need',
      'of',
      'Ashish Vaswani* Noam Shazeer* Niki Parmar* Jakob Uszkoreit*',
    ].join('\n');

    expect(titleFromPlainText(ocr)).toBe('Attention Is All You Need');
  });

  it('reads a title split by OCR symbol soup above names joined by "and"', () => {
    // OCR of the first page of a scanned Trends in Genetics paper.
    const ocr = [
      '-.',
      'From fitness landscapes to seascapes:',
      '[| | [_] [| -',
      'non-equilibrium dynamics of selection',
      'and adaptation',
      'Ville Mustonen and Michael Lassig',
      'Institut flr Theoretische Physik, Universitat zu Kéln, ZllpicherstraRe 77, 50937 Koln, Germany',
    ].join('\n');

    expect(titleFromPlainText(ocr)).toBe('From fitness landscapes to seascapes: non-equilibrium dynamics of selection and adaptation');
  });

  it('does not take a Title Case title with lowercase function words for a byline', () => {
    const ocr = ['Selection Dynamics in Evolving Populations', 'Ann Lee and Bo Chen'].join('\n');
    expect(titleFromPlainText(ocr)).toBe('Selection Dynamics in Evolving Populations');
  });

  it('returns undefined when no byline confirms a candidate', () => {
    const ocr = [
      'This document describes the internal procedures of the laboratory',
      'and must not be distributed outside of the department without consent',
    ].join('\n');

    expect(titleFromPlainText(ocr)).toBeUndefined();
  });
});
