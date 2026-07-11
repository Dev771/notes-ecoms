import { parseAcademicQuery } from './query-parser';

describe('parseAcademicQuery', () => {
  const cases: Array<[string, ReturnType<typeof parseAcademicQuery>]> = [
    [
      'class 10 science carbon',
      {
        classLevel: 10,
        subject: 'SCIENCE',
        chapterNo: undefined,
        residual: 'carbon',
      },
    ],
    [
      'ch 4 sci',
      { classLevel: undefined, subject: 'SCIENCE', chapterNo: 4, residual: '' },
    ],
    [
      'Ch 5 Maths',
      { classLevel: undefined, subject: 'MATHS', chapterNo: 5, residual: '' },
    ],
    [
      'real numbers',
      {
        classLevel: undefined,
        subject: undefined,
        chapterNo: undefined,
        residual: 'real numbers',
      },
    ],
    [
      'sst history chapter 2',
      {
        classLevel: undefined,
        subject: 'SST',
        chapterNo: 2,
        residual: 'history',
      },
    ],
    [
      'english first flight',
      {
        classLevel: undefined,
        subject: 'ENGLISH',
        chapterNo: undefined,
        residual: 'first flight',
      },
    ],
    [
      '10th maths',
      { classLevel: 10, subject: 'MATHS', chapterNo: undefined, residual: '' },
    ],
    [
      'class 9',
      { classLevel: 9, subject: undefined, chapterNo: undefined, residual: '' },
    ],
    [
      'carbon and its compounds',
      {
        classLevel: undefined,
        subject: undefined,
        chapterNo: undefined,
        residual: 'carbon and its compounds',
      },
    ],
    [
      'social science class 10',
      { classLevel: 10, subject: 'SST', chapterNo: undefined, residual: '' },
    ],
  ];

  it.each(cases)('parses %s', (q, expected) => {
    expect(parseAcademicQuery(q)).toEqual(expected);
  });
});
