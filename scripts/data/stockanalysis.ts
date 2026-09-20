/**
 * Bootstrap datasets transcribed from stockanalysis.com.
 *
 * SECONDARY SOURCE. Not annual reports. Everything imported from here is
 * written unverified and stays that way until checked against the company's
 * own filing.
 *
 * Amounts are in millions BDT exactly as the source prints them. Per-share
 * figures are as printed and never scaled. Capex is negative, because that is
 * how a cash flow statement shows an outflow.
 *
 * `published` holds figures used only to verify the transcription — they are
 * never stored, only recomputed and compared.
 */

export interface Dataset {
  fiscalYears: number[]
  /** line item tag -> one value per fiscal year, aligned by index */
  data: Record<string, (number | null)[]>
  published: {
    /** Free cash flow as the source states it; must equal OCF + capex. */
    fcf: number[]
    /** Return on equity %, where available. */
    roePct?: number[]
  }
}

/** Per-share tags, which must be stored with scale 'unit'. */
export const UNSCALED_TAGS = new Set(['eps_basic', 'navps', 'dividend_per_share'])

export const DATASETS: Record<string, Dataset> = {
  SQURPHARMA: {
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    data: {
      revenue: [50703, 57598, 60708, 70101, 76288],
      gross_profit: [25233, 28879, 28235, 32553, 35911],
      operating_profit: [15269, 16860, 16690, 17974, 19393],
      net_profit: [15947, 18157, 18980, 20926, 23968],
      cash_and_equivalents: [43364, 48962, 50094, 52013, 55396],
      current_assets: [55076, 62348, 70487, 71206, 74562],
      ppe: [22884, 27183, 26059, 27750, 31687],
      total_assets: [95452, 111758, 121816, 132637, 146815],
      current_liabilities: [3179, 3662, 4229, 5282, 5823],
      total_debt: [103.71, 1914, 1987, 1429, 825.5],
      total_liabilities: [4557, 6555, 6620, 6716, 6860],
      total_equity: [90895, 105203, 115197, 125922, 139956],
      net_operating_cash_flow: [10976, 12875, 8546, 18529, 17302],
      capex: [-3798, -6183, -2861, -4181, -6177],
      net_investing_cash_flow: [3607, -3970, 787.69, -7049, -3897],
      net_financing_cash_flow: [-3819, -3754, -8762, -9833, -10313],
      dividends_paid: [-3923, -5302, -8803, -9275, -9709],
      eps_basic: [17.99, 20.48, 21.41, 23.61, 27.04],
      navps: [102.54, 118.68, 129.95, 142.05, 157.88],
      dividend_per_share: [6.0, 10.0, 10.5, 11.0, 12.0],
    },
    published: {
      fcf: [7178, 6692, 5685, 14348, 11125],
      roePct: [18.96, 18.52, 17.22, 17.36, 18.03],
    },
  },

  MARICO: {
    fiscalYears: [2022, 2023, 2024, 2025, 2026],
    data: {
      revenue: [13032, 14136, 14524, 16309, 20712],
      gross_profit: [7051, 7305, 8406, 9714, 10212],
      operating_profit: [4405, 4872, 5831, 6703, 7254],
      net_profit: [3554, 3872, 4606, 5906, 6492],
      cash_and_equivalents: [505.19, 2229, 1887, 3092, 1575],
      current_assets: [5673, 9970, 15014, 12143, 6631],
      total_assets: [7048, 11636, 16907, 13840, 8349],
      current_liabilities: [4236, 7977, 8521, 6104, 5302],
      total_debt: [128.12, 103.71, 640.74, 174.82, 149.25],
      total_liabilities: [4359, 8050, 8697, 6308, 5451],
      total_equity: [2689, 3586, 8210, 7533, 2899],
      net_operating_cash_flow: [3605, 5394, 6150, 4606, 5586],
      capex: [-313.76, -517.62, -243.71, -168.53, -229.92],
      net_investing_cash_flow: [-499.12, -2641, -4840, 3698, 4095],
      net_financing_cash_flow: [-2997, -1029, -1651, -7100, -11198],
      dividends_paid: [-2520, -963.57, -2029, -6584, -11104],
      eps_basic: [112.82, 122.93, 146.23, 187.49, 206.09],
      navps: [85.37, 113.85, 260.64, 239.13, 92.02],
      dividend_per_share: [80.0, 75.0, 20.0, 384.0, 207.5],
    },
    published: { fcf: [3292, 4876, 5906, 4438, 5356] },
  },

  BERGERPBL: {
    fiscalYears: [2022, 2023, 2024, 2025, 2026],
    data: {
      revenue: [22195, 25899, 26251, 28525, 29270],
      gross_profit: [7688, 7582, 8384, 8950, 9374],
      operating_profit: [3884, 3898, 4317, 4440, 4576],
      net_profit: [2907, 3010, 3243, 3370, 3720],
      cash_and_equivalents: [2442, 3877, 7665, 5943, 6480],
      current_assets: [9401, 11721, 16258, 13996, 14244],
      total_assets: [16947, 20001, 25103, 23844, 28092],
      current_liabilities: [5619, 6287, 9677, 7247, 7592],
      total_debt: [567.02, 579.49, 994.61, 1086, 1681],
      total_liabilities: [6401, 7025, 10748, 8380, 8438],
      total_equity: [10546, 12976, 14355, 15463, 19654],
      net_operating_cash_flow: [2936, 3446, 6476, 2734, 4335],
      capex: [-1291, -1398, -1153, -1855, -4828],
      net_investing_cash_flow: [-1400, -1480, -1093, -1748, -3730],
      net_financing_cash_flow: [-3222, -549.66, -1666, -2725, -76.98],
      dividends_paid: [-3136, -465.14, -1857, -2320, -2434],
      eps_basic: [62.68, 64.91, 69.92, 71.2, 76.83],
      navps: [227.39, 279.78, 309.53, 333.42, 400.24],
      dividend_per_share: [40.0, 40.0, 50.0, 52.5, 52.5],
    },
    published: { fcf: [1646, 2048, 5324, 878.68, -492.9] },
  },

  RENATA: {
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    data: {
      revenue: [29971, 31071, 32971, 37709, 42892],
      gross_profit: [14184, 14541, 13670, 16678, 17572],
      operating_profit: [6525, 6221, 3094, 5100, 4078],
      net_profit: [5062, 5111, 2339, 3616, 2221],
      cash_and_equivalents: [1406, 778.57, 2601, 976.06, 1827],
      current_assets: [17194, 15505, 17039, 19593, 19325],
      total_assets: [34773, 42015, 48827, 56474, 59021],
      current_liabilities: [7693, 11189, 13243, 13580, 12306],
      total_debt: [4802, 8896, 14281, 17236, 18897],
      total_liabilities: [9062, 12603, 18218, 22574, 23983],
      total_equity: [25711, 29412, 30609, 33900, 35038],
      net_operating_cash_flow: [4320, 3009, 2085, 2083, 4721],
      capex: [-4423, -10099, -5770, -5616, -4284],
      net_investing_cash_flow: [-4998, -6080, -4619, -5923, -4486],
      net_financing_cash_flow: [666.55, 2419, 3887, 2257, 546.54],
      dividends_paid: [-1141, -1430, -1498, -720.52, -1059],
      eps_basic: [44.13, 44.56, 20.4, 31.53, 19.36],
      navps: [224.17, 256.43, 266.87, 295.56, 305.49],
      dividend_per_share: [12.319, 13.084, 6.25, 9.2, 5.5],
    },
    published: { fcf: [-102.96, -7090, -3685, -3533, 437.19] },
  },

  OLYMPIC: {
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    data: {
      revenue: [18033, 21439, 25785, 25929, 27721],
      gross_profit: [5267, 4903, 6107, 6154, 6610],
      operating_profit: [2417, 1473, 2097, 2189, 2176],
      net_profit: [2037, 1205, 1556, 1834, 2010],
      cash_and_equivalents: [768.93, 594.5, 849.43, 889.52, 1593],
      current_assets: [9527, 9113, 8249, 7870, 9753],
      total_assets: [14415, 14427, 14080, 14021, 16178],
      current_liabilities: [4648, 4616, 3609, 3325, 3700],
      total_debt: [1987, 2707, 2163, 555.93, 51.94],
      total_liabilities: [5175, 5062, 4059, 3366, 3712],
      total_equity: [9239, 9365, 10021, 10656, 12466],
      net_operating_cash_flow: [1868, 701.06, 1389, 3752, 2290],
      capex: [-1276, -1317, -964.12, -1300, -870.45],
      net_investing_cash_flow: [-1046, -514.24, 406.64, -922.94, -720.48],
      net_financing_cash_flow: [-728.85, -1089, -1002, -2353, -868.51],
      dividends_paid: [-983.39, -1194, -935.11, -1248, -251.68],
      eps_basic: [10.19, 6.03, 7.78, 9.17, 10.06],
      navps: [46.21, 46.84, 50.12, 53.29, 62.35],
      dividend_per_share: [5.4, 4.5, 6.0, 1.0, 3.0],
    },
    published: { fcf: [591.39, -616.04, 425.31, 2451, 1419] },
  },

  BSRMSTEEL: {
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    data: {
      revenue: [54983, 67121, 84525, 82706, 103665],
      gross_profit: [7226, 7040, 8109, 9169, 11493],
      operating_profit: [5335, 5181, 6257, 6477, 8633],
      net_profit: [3047, 3278, 2979, 3797, 5176],
      cash_and_equivalents: [16417, 9074, 4443, 5380, 1917],
      current_assets: [46711, 55500, 41930, 55734, 43960],
      total_assets: [72385, 82021, 76899, 97169, 87824],
      current_liabilities: [40141, 48891, 42858, 56239, 29394],
      total_debt: [41535, 49433, 40759, 59687, 45488],
      total_liabilities: [48933, 56086, 49335, 66741, 53791],
      total_equity: [23452, 25935, 27565, 30428, 34033],
      net_operating_cash_flow: [7846, 3993, 10961, 6134, 7307],
      capex: [-443.81, -2095, -9083, -11480, -16353],
      net_investing_cash_flow: [-1647, -2563, -7328, -11513, -818.81],
      net_financing_cash_flow: [9273, -8798, -8285, 6320, -9951],
      dividends_paid: [-938.5, -1145, -1132, -939.97, -1201],
      eps_basic: [8.1, 8.72, 7.92, 10.1, 13.77],
      navps: [62.38, 68.99, 73.32, 80.93, 90.52],
      dividend_per_share: [4.0, 3.0, 2.5, 3.2, 5.0],
    },
    published: { fcf: [7402, 1898, 1878, -5345, -9046] },
  },

  BSRMLTD: {
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    data: {
      revenue: [59906, 79953, 115062, 83525, 96638],
      gross_profit: [7100, 6490, 10320, 9610, 11414],
      operating_profit: [5230, 4640, 7970, 6427, 8689],
      net_profit: [4970, 3088, 2914, 4323, 6142],
      cash_and_equivalents: [1598, 5751, 1874, 1212, 2117],
      current_assets: [32999, 70918, 57375, 52381, 45679],
      total_assets: [80533, 118617, 104042, 99575, 93743],
      current_liabilities: [37600, 74031, 57719, 49444, 37170],
      total_debt: [34670, 70623, 54014, 45375, 32813],
      total_liabilities: [42447, 78522, 62104, 54770, 43942],
      total_equity: [38086, 40095, 41938, 44804, 49801],
      net_operating_cash_flow: [8741, 6714, 3053, 4019, 13080],
      capex: [-1276, -963.12, -573.42, -1185, -1413],
      net_investing_cash_flow: [-1626, -2763, 2633, -12.76, -558.64],
      net_financing_cash_flow: [-5756, 91.89, -9577, -4674, -11617],
      dividends_paid: [-585.35, -1176, -1066, -746.34, -1054],
      eps_basic: [18.96, 10.34, 9.76, 14.48, 20.57],
      navps: [127.56, 134.29, 140.46, 150.06, 166.79],
      dividend_per_share: [5.0, 3.5, 2.5, 3.5, 5.0],
    },
    published: { fcf: [7465, 5751, 2479, 2834, 11668] },
  },

  LHB: {
    fiscalYears: [2021, 2022, 2023, 2024, 2025],
    data: {
      revenue: [20534, 23594, 28388, 27543, 29314],
      gross_profit: [6640, 8334, 10269, 8245, 8846],
      operating_profit: [4818, 5982, 7756, 5967, 6551],
      net_profit: [3882, 4445, 5942, 3819, 5108],
      cash_and_equivalents: [5277, 4844, 9346, 9601, 9518],
      current_assets: [10710, 10450, 18216, 18488, 21664],
      total_assets: [29622, 28971, 36274, 36577, 41377],
      current_liabilities: [7153, 8917, 11847, 15855, 20468],
      total_debt: [60.33, 38.1, 163.41, 386.82, 101.3],
      total_liabilities: [9828, 11261, 14048, 17985, 22313],
      total_equity: [19794, 17710, 22226, 18592, 19063],
      net_operating_cash_flow: [6077, 6694, 7926, 7923, 8492],
      capex: [-945.77, -701.44, -376.98, -1228, -4091],
      net_investing_cash_flow: [-910.86, -633.05, -221.98, -1006, -3874],
      net_financing_cash_flow: [-1246, -6517, -3215, -6757, -4667],
      dividends_paid: [-1202, -6468, -2003, -7848, -4443],
      eps_basic: [3.34, 3.83, 5.12, 3.29, 4.4],
      navps: [17.04, 15.25, 19.14, 16.01, 16.41],
      dividend_per_share: [2.5, 4.8, 5.0, 3.8, 4.0],
    },
    published: { fcf: [5131, 5992, 7549, 6694, 4401] },
  },
}
