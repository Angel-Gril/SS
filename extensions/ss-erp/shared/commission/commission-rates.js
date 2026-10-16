(function (root) {
  var SCHEMA_VERSION = 'ozon-calculator/commission-rates-v1';
  var DEFAULT_SOURCE_URL = 'https://docs.ozon.ru/global/zh-hans/commissions';
  var DEFAULT_BANDS = [
    { minRUB: 0, maxRUB: 1500 },
    { minRUB: 1500, maxRUB: 5000 },
    { minRUB: 5000, maxRUB: 0 },
  ];

  var CATEGORY_ALIASES = [
    {
      test: /(audio|音频|视频设备|影音|аудио|наушник|audio\/video)/i,
      aliases: ['音频设备和音频、视频设备的配件', '耳机', '音响', 'Чехол для наушников', 'наушник', 'наушники', 'колонка', 'акустика', 'airpods', 'headphone', 'earphone', 'headset', 'headphone case', 'speaker', 'audio accessory'],
    },
    {
      test: /(手机|智能手机|смартфон|телефон|iphone|phone|smartphone)/i,
      aliases: ['智能手机和手机配件', '手机配件', '手机壳', 'смартфон', 'телефон', 'айфон', 'чехол для iphone', 'чехол для телефона', 'iphone', 'phone case', 'smartphone accessory', 'screen protector'],
    },
    {
      test: /(电脑|笔记本|ноутбук|компьютер|laptop|computer|desktop pc)/i,
      aliases: ['电脑和笔记本电脑', '笔记本', 'ноутбук', 'компьютер', 'пк', 'laptop', 'notebook', 'computer', 'desktop pc', 'laptop sleeve'],
    },
    {
      test: /(electronics accessories|电子配件|электрон.*аксессуар|кабель|заряд)/i,
      aliases: ['电子配件', '数码配件', 'электронные аксессуары', 'кабель', 'usb кабель', 'зарядное устройство', 'зарядка', 'адаптер питания', 'power bank', 'zaryadnoe ustroystvo', 'zaryadka', 'kabel', 'adapter pitaniya', 'electronics accessories', 'electronic accessory', 'usb cable', 'charger', 'charging cable', 'power adapter'],
    },
    {
      test: /(video games|电子游戏|видеоигр|игр.*nintendo|игр.*playstation)/i,
      aliases: ['电子游戏', '游戏软件', 'видеоигра', 'видеоигры', 'игра для nintendo', 'игра для playstation', 'igra dlya nintendo', 'videoigra', 'video games', 'video game', 'nintendo switch game', 'playstation game'],
    },
    {
      test: /(game consoles|photo equipment|游戏机|摄影|игров.*пристав|геймпад|фотоаппарат|камера)/i,
      aliases: ['游戏机', '游戏机配件', '摄影器材', 'игровая приставка', 'геймпад', 'джойстик', 'фотоаппарат', 'камера', 'объектив', 'igrovaya pristavka', 'geympad', 'fotoapparat', 'kamera', 'game console', 'gaming console', 'gamepad', 'controller', 'photo equipment', 'camera', 'lens'],
    },
    {
      test: /(large household appliances|major appliances|大型家电|бытов.*техник|холодильник|посудомоечн|стиральн)/i,
      aliases: ['大型家电', '大家电', 'бытовая техника', 'крупная бытовая техника', 'холодильник', 'посудомоечная машина', 'стиральная машина', 'сушильная машина', 'bytovaya tehnika', 'krupnaya bytovaya tehnika', 'posudomoechnaya mashina', 'stiralnaya mashina', 'large household appliances', 'major appliances', 'refrigerator', 'dishwasher', 'washing machine', 'dryer'],
    },
    {
      test: /(underwear|hosiery|内衣|袜|бель[её]|носк|колгот)/i,
      aliases: ['内衣', '袜品', '袜子', '连裤袜', 'нижнее белье', 'белье', 'трусы', 'бюстгальтер', 'носки', 'колготки', 'чулки', 'термобелье', 'nizhnee bele', 'bele', 'trusy', 'byustgalter', 'noski', 'kolgotki', 'chulki', 'termobele', 'underwear', 'hosiery', 'socks', 'tights', 'stockings', 'bra', 'briefs'],
    },
    {
      test: /(服装|服饰|衣服|配饰|одежд|clothing|apparel)/i,
      aliases: ['服装', '服饰', '衣服', '运动衫', '卫衣', '服装配饰', 'одежда', 'женская одежда', 'мужская одежда', 'спортивная одежда', 'свитшот', 'свитшоты', 'толстовка', 'толстовки', 'олимпийка', 'олимпийки', 'худи', 'кофта', 'джемпер', 'футболка', 'лонгслив', 'рашгард', 'рашгарды', 'рубашка', 'куртка', 'брюки', 'джинсы', 'леггинсы', 'топ', 'майка', 'платье', 'юбка', 'odezhda', 'zhenskaya odezhda', 'muzhskaya odezhda', 'sportivnaya odezhda', 'svitshot', 'svitshoty', 'tolstovka', 'tolstovki', 'olimpiyka', 'olimpiyki', 'hudi', 'rashgard', 'rashgardy', 'longsliv', 'legginsy', 'spandeks', 'apparel', 'clothes', 'clothing', 'sweatshirt', 'hoodie', 'pullover', 'crewneck', 'rashguard', 'rash guards', 't-shirt', 'shirt', 'jacket', 'pants', 'jeans', 'leggings', 'sports top', 'dress'],
    },
    {
      test: /(鞋|обув|footwear|shoe|sneaker)/i,
      aliases: ['鞋类', '鞋', '运动鞋', 'обувь', 'кроссовки', 'ботинки', 'сапоги', 'туфли', 'shoes', 'shoe', 'sneakers', 'footwear', 'boots'],
    },
    {
      test: /(beauty|cosmetic|美容|美妆|космет|парфюм|уход)/i,
      aliases: ['美容与健康', '美容健康', '美妆', '护肤', '面霜', '香水', 'косметика', 'крем', 'крем для лица', 'шампунь', 'маска для лица', 'уход за кожей', 'сыворотка', 'парфюм', 'духи', 'туалетная вода', 'kosmetika', 'krem', 'shampun', 'uhod za kozhey', 'syvorotka', 'parfyum', 'duhi', 'beauty', 'cosmetics', 'skincare', 'cream', 'face cream', 'shampoo', 'serum', 'perfume', 'fragrance'],
    },
    {
      test: /(cosmetic appliances|professional beauty|美容仪|космет.*прибор|фен|стайлер|эпилятор)/i,
      aliases: ['美容仪器', '美容电器', 'косметический прибор', 'фен', 'стайлер', 'плойка', 'выпрямитель', 'эпилятор', 'бритва', 'fen', 'stailer', 'ployka', 'vypryamitel', 'epilyator', 'cosmetic appliance', 'beauty device', 'hair dryer', 'styler', 'epilator'],
    },
    {
      test: /(jewelry|jewellery|珠宝|首饰|украшен|ювелир)/i,
      aliases: ['珠宝', '首饰', 'украшение', 'ювелирные изделия', 'кольцо', 'серьги', 'браслет', 'jewelry', 'jewellery', 'ring', 'earrings', 'bracelet', 'necklace'],
    },
    {
      test: /(smartwatch|smartwatches|fitness bracelets|sports watch|智能手表|运动手表|手表|手环|смарт.?час|фитнес.?браслет|спортивн.*час)/i,
      aliases: ['智能手表', '运动手表', '智能手环', 'смарт часы', 'смарт-часы', 'умные часы', 'фитнес браслет', 'фитнес-браслет', 'спортивные часы', 'smartwatch', 'smart watch', 'fitness bracelet', 'sports watch', 'umnye chasy', 'sportivnye chasy'],
    },
    {
      test: /(tv|television|电视|телевизор)/i,
      aliases: ['电视', 'телевизор', 'tv', 'television'],
    },
    {
      test: /(apple devices|apple|苹果设备)/i,
      aliases: ['苹果设备', 'apple', 'iphone', 'ipad', 'macbook', 'airpods', 'айфон', 'айпад', 'макбук'],
    },
    {
      test: /(dyson|戴森|дайсон)/i,
      aliases: ['戴森', 'dyson', 'дайсон'],
    },
    {
      test: /(digital products|digital books|数字商品|数字图书|цифров)/i,
      aliases: ['数字商品', '数字图书', '电子书', 'цифровой товар', 'цифровая книга', 'электронная книга', 'цифровой код', 'digital product', 'digital book', 'ebook', 'e-book', 'electronic book', 'digital code'],
    },
    {
      test: /(house\s*&\s*garden|home\s*&\s*garden|家居|花园|дом|сад)/i,
      aliases: ['家居与花园', '家居', '花园', '厨房', '锅具', '咖啡机', 'дом', 'для дома', 'товары для дома', 'сад', 'дача', 'кухня', 'сковорода', 'кастрюля', 'посуда', 'кофемашина', 'чайник', 'home', 'house', 'garden', 'kitchen', 'cookware', 'frying pan', 'pan', 'coffee machine', 'kettle'],
    },
    {
      test: /(decor|cleaning|storage|装饰|清洁|收纳|декор|уборк|хранен)/i,
      aliases: ['装饰', '清洁', '收纳', '整理', 'декор', 'уборка', 'чистящие средства', 'хранение', 'органайзер', 'короб для хранения', 'hranenie', 'organayzer', 'uborka', 'cleaning', 'storage', 'decor', 'organizer', 'storage box'],
    },
    {
      test: /(furniture|家具|мебел)/i,
      aliases: ['家具', 'мебель', 'стол', 'стул', 'кресло', 'офисное кресло', 'шкаф', 'полка', 'комод', 'диван', 'matras', 'kreslo', 'ofisnoe kreslo', 'mebel', 'furniture', 'table', 'chair', 'armchair', 'office chair', 'cabinet', 'shelf', 'sofa', 'mattress'],
    },
    {
      test: /(hand.*tools|measuring tools|工具|测量|измер|инструмент|алкотестер|мультиметр)/i,
      aliases: ['工具', '手动工具', '测量工具', '测量仪', '酒精测试仪', 'инструмент', 'ручной инструмент', 'измерительный инструмент', 'измерительные приборы', 'алкотестер', 'тестер', 'мультиметр', 'рулетка', 'уровень', 'весы', 'termometr', 'alkotester', 'izmeritelnye pribory', 'tester', 'multimetr', 'ruletka', 'uroven', 'hand tool', 'measuring tool', 'tester', 'multimeter', 'alcohol tester', 'breathalyzer', 'scale'],
    },
    {
      test: /(water filters|净水|滤水|фильтр.*вод|водоочист)/i,
      aliases: ['净水器', '滤水器', '水过滤器', 'фильтр для воды', 'фильтры для воды', 'водоочиститель', 'картридж для фильтра воды', 'filtr dlya vody', 'filtry dlya vody', 'water filter', 'water purifier', 'filter cartridge'],
    },
    {
      test: /(bathroom equipment|卫浴|сантех|душ|смесител)/i,
      aliases: ['卫浴', '浴室设备', 'сантехника', 'душ', 'смеситель', 'раковина', 'унитаз', 'vannaya', 'santehnika', 'smesitel', 'bathroom equipment', 'shower', 'faucet', 'sink'],
    },
    {
      test: /(construction|renovation|finishing materials|建材|装修|строит|ремонт|отделоч)/i,
      aliases: ['建材', '装修', '施工', 'стройматериалы', 'строительство', 'ремонт', 'отделочные материалы', 'краска', 'плитка', 'обои', 'дрель', 'шуруповерт', 'stroitelstvo', 'remont', 'otdelochnye materialy', 'construction', 'renovation', 'finishing materials', 'paint', 'tile', 'wallpaper', 'drill'],
    },
    {
      test: /(car products|cars|motor vehicles|tires|dvr|radar detector|auto|汽车|汽配|轮胎|авто|автомоб|шины|видеорегистратор|радар)/i,
      aliases: ['汽车用品', '汽车配件', '汽配', '轮胎', '行车记录仪', 'автотовары', 'авто', 'автомобиль', 'для автомобиля', 'машина', 'шины', 'автошины', 'домкрат', 'держатель телефона', 'видеорегистратор', 'радар детектор', 'avtotovary', 'avto', 'shiny', 'domkrat', 'videoregistrator', 'car products', 'car accessory', 'auto accessory', 'tires', 'phone holder', 'dash cam', 'dvr', 'radar detector'],
    },
    {
      test: /(sports\s*&\s*recreation|sports products|运动|户外|спорт|отдых)/i,
      exclude: /(运动手表|智能手表|手表|手环|smartwatch|smart watch|sports watch|fitness bracelets|смарт.?час|фитнес.?браслет|час)/i,
      aliases: ['运动与休闲商品', '运动', '户外', 'спорт', 'спортивный', 'спортивная бутылка', 'бутылка для воды', 'фитнес', 'йога', 'тренировка', 'sports', 'sporting goods', 'fitness', 'yoga', 'water bottle', 'training'],
    },
    {
      test: /(bicycles|electric kick scooter|自行车|滑板车|велосипед|самокат)/i,
      aliases: ['自行车', '滑板车', 'велосипед', 'самокат', 'электросамокат', 'bicycle', 'bike', 'scooter', 'electric scooter'],
    },
    {
      test: /(adult products|成人用品|интим|эротич)/i,
      aliases: ['成人用品', 'интимные товары', 'интим', 'эротические товары', 'adult products', 'intimate products'],
    },
    {
      test: /(parapharmaceuticals|парафармац|медицинск.*издел|медтовар)/i,
      aliases: ['准药品', '医疗用品', 'парафармацевтика', 'медицинские изделия', 'медтовары', 'лейкопластырь', 'бинт', 'medtovary', 'medical goods', 'parapharmaceuticals'],
    },
    {
      test: /(e-cigarette|heating system|电子烟|加热烟|вейп|электронн.*сигарет|табак.*нагрев)/i,
      aliases: ['电子烟配件', '加热烟配件', 'вейп', 'электронная сигарета', 'картридж для электронной сигареты', 'испаритель', 'жидкость для вейпа', 'система нагревания табака', 'veyp', 'elektronnaya sigareta', 'e-cigarette', 'vape', 'vape cartridge', 'heating system accessory'],
    },
    {
      test: /(vitamins|dietary supplements|sports nutrition|维生素|膳食补充剂|витамин|бад|спортпит)/i,
      aliases: ['维生素和膳食补充剂', '维生素', '膳食补充剂', 'витамины', 'витамин', 'бад', 'биодобавка', 'спортпит', 'vitamins', 'dietary supplements', 'supplements', 'sports nutrition'],
    },
    {
      test: /(pharmacy|medications|orthopedics|oral care|contact lenses|rehabilitation|药|药房|隐形眼镜|口腔护理|ортопед|лекарств|линз|реабилитац|аптек)/i,
      aliases: ['药房', '药品', '隐形眼镜', '口腔护理', '康复用品', 'ортопедия', 'лекарство', 'аптека', 'линзы', 'контактные линзы', 'зубная щетка', 'ирригатор', 'реабилитация', 'трость', 'костыль', 'pharmacy', 'medication', 'contact lenses', 'oral care', 'orthopedics', 'rehabilitation'],
    },
    {
      test: /(food|fresh food|食品|食物|咖啡|еда|продукт|кофе|чай)/i,
      exclude: /(pet food|farm products|宠物食品|宠物用品|корм|зоотовар)/i,
      aliases: ['食品', '食物', '咖啡', '茶', '巧克力', 'еда', 'продукты', 'кофе', 'чай', 'снэк', 'шоколад', 'конфеты', 'печенье', 'орехи', 'мед', 'shokolad', 'konfety', 'pechene', 'orehi', 'food', 'fresh food', 'coffee', 'tea', 'snack', 'chocolate', 'candy', 'cookies', 'nuts'],
    },
    {
      test: /(household chemicals|personal hygiene|hygiene|日化|个人卫生|гигиен|бытов.*хим)/i,
      aliases: ['日化', '个人卫生', 'бытовая химия', 'гигиена', 'мыло', 'зубная паста', 'household chemicals', 'personal hygiene', 'soap', 'toothpaste'],
    },
    {
      test: /(strollers|car seats|婴儿车|安全座椅|коляск|автокресл)/i,
      aliases: ['婴儿车', '儿童推车', '安全座椅', 'детская коляска', 'коляска', 'автокресло', 'detskaya kolyaska', 'detskie kolyaski', 'kolyaska', 'avtokreslo', 'baby stroller', 'stroller', 'car seat'],
    },
    {
      test: /(toys|kids electronics|kids furniture|kids sports|kids textiles|hobbies|creative activities|stationery|玩具|儿童|婴儿|детск|игруш|канцеляр)/i,
      aliases: ['儿童用品', '儿童玩具', '玩具', '文具', 'игрушка', 'игрушки', 'детский', 'детская', 'для детей', 'конструктор', 'кукла', 'настольная игра', 'канцелярия', 'творчество', 'lego', 'konstruktor', 'kukla', 'toys', 'toy', 'kids products', 'construction toy', 'doll', 'board game', 'stationery'],
    },
    {
      test: /(pet food|pet hygiene|pet clothing|pet space|pet products|宠物|宠物食品|собак|кошк|зоотовар|корм)/i,
      aliases: ['宠物用品', '宠物食品', '宠物', 'корм для собак', 'корм для кошек', 'корм', 'лакомство для собак', 'наполнитель для кошек', 'собака', 'кошка', 'зоотовары', 'korm dlya sobak', 'korm dlya koshek', 'pet products', 'pet food', 'dog food', 'cat food', 'dog', 'cat'],
    },
    {
      test: /(books|图书|书籍|книг)/i,
      aliases: ['图书', '书籍', 'книга', 'книги', 'учебник', 'books', 'book', 'textbook'],
    },
  ];

  function toText(value) {
    return value == null ? '' : String(value).trim();
  }

  function toNumber(value, fallbackValue) {
    var number = Number(value);
    return Number.isFinite(number) ? number : (fallbackValue == null ? 0 : fallbackValue);
  }

  function decodeHtml(value) {
    return toText(value)
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#160;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function stripHtml(value) {
    return decodeHtml(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parsePercent(value) {
    var match = toText(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function normalizeKey(value) {
    return toText(value).toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я\u4e00-\u9fff]+/g, '');
  }

  function uniqueStrings(values) {
    var seen = {};
    return (Array.isArray(values) ? values : []).map(toText).filter(function (value) {
      var key = normalizeKey(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function uniqueIds(values) {
    var seen = {};
    return (Array.isArray(values) ? values : []).map(function (value) {
      var number = toNumber(value, 0);
      return number > 0 ? String(Math.trunc(number)) : '';
    }).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function buildAliases(category, group) {
    var base = [category, group];
    var categoryText = toText(category);
    CATEGORY_ALIASES.forEach(function (item) {
      if (item.test.test(categoryText) && !(item.exclude && item.exclude.test(categoryText))) {
        base = base.concat(item.aliases);
      }
    });
    return uniqueStrings(base);
  }

  function parseTableRows(html) {
    var rows = [];
    var rowRe = /<tr\b[\s\S]*?<\/tr>/gi;
    var rowMatch;
    while ((rowMatch = rowRe.exec(String(html || '')))) {
      var rowHtml = rowMatch[0];
      var cells = [];
      var cellRe = /<t[dh]\b[\s\S]*?>([\s\S]*?)<\/t[dh]>/gi;
      var cellMatch;
      while ((cellMatch = cellRe.exec(rowHtml))) {
        cells.push(stripHtml(cellMatch[1]));
      }
      if (cells.length) rows.push(cells);
    }
    return rows;
  }

  function parseMarkdownTableRows(text) {
    var rows = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var raw = toText(line);
      if (!raw || raw.indexOf('|') < 0) return;
      if (/^\|?[\s:-]+\|[\s:-| ]+$/.test(raw)) return;
      var normalized = raw.replace(/^\|/, '').replace(/\|$/, '');
      var cells = normalized.split('|').map(function (cell) {
        return stripHtml(cell);
      });
      if (cells.length) rows.push(cells);
    });
    return rows;
  }

  function selectCommissionHtml(html) {
    var source = String(html || '');
    var markerIndex = source.search(/Ozon\s*商品销售佣金|商品销售佣金|комисс|sales\s+fee|fee\s+for\s+selling|commission/i);
    if (markerIndex < 0) return source;
    var datedIndex = source.slice(markerIndex).search(/2025|12月1日|декабр/i);
    var start = datedIndex >= 0 ? markerIndex + datedIndex : markerIndex;
    var nextHtmlHeading = source.slice(start + 1).search(/<h[123]\b/i);
    var nextMarkdownHeading = source.slice(start + 1).search(/\n#{1,6}\s+/);
    var nextHeading = -1;
    if (nextHtmlHeading > 0) nextHeading = nextHtmlHeading;
    if (nextMarkdownHeading > 0 && (nextHeading < 0 || nextMarkdownHeading < nextHeading)) nextHeading = nextMarkdownHeading;
    if (nextHeading > 0) return source.slice(start, start + 1 + nextHeading);
    return source.slice(start);
  }

  function inferBands(percentValues) {
    if (percentValues.length >= 6) {
      return DEFAULT_BANDS.map(function (band, index) {
        return {
          minRUB: band.minRUB,
          maxRUB: band.maxRUB,
          rfbs: percentValues[index * 2],
          fbp: percentValues[index * 2 + 1],
        };
      });
    }
    if (percentValues.length >= 4) {
      return [
        { minRUB: 0, maxRUB: 1500, rfbs: percentValues[0], fbp: percentValues[1] },
        { minRUB: 1500, maxRUB: 0, rfbs: percentValues[2], fbp: percentValues[3] },
      ];
    }
    if (percentValues.length >= 2) {
      return [{ minRUB: 0, maxRUB: 0, rfbs: percentValues[0], fbp: percentValues[1] }];
    }
    return [];
  }

  function normalizeBand(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      minRUB: Math.max(0, toNumber(value.minRUB, 0)),
      maxRUB: Math.max(0, toNumber(value.maxRUB, 0)),
      rfbs: Math.max(0, toNumber(value.rfbs, 0)),
      fbp: Math.max(0, toNumber(value.fbp, value.rfbs || 0)),
    };
  }

  function normalizeRule(value) {
    value = value && typeof value === 'object' ? value : {};
    var category = toText(value.category || value.name);
    var group = toText(value.group || value.categoryGroup);
    var categoryIds = uniqueIds([
      value.categoryId,
      value.category1Id,
      value.category2Id,
      value.category3Id,
      value.descriptionCategoryId,
      value.description_category_id,
      value.typeId,
      value.type_id,
    ].concat(Array.isArray(value.categoryIds) ? value.categoryIds : []));
    return {
      group: group,
      category: category,
      categoryIds: categoryIds,
      brand: toText(value.brand),
      typeSpecific: value.typeSpecific === true,
      aliases: uniqueStrings((Array.isArray(value.aliases) ? value.aliases : []).concat(value.typeSpecific === true ? [] : buildAliases(category, group))),
      bands: (Array.isArray(value.bands) ? value.bands : []).map(normalizeBand).filter(function (band) {
        return band.rfbs > 0 || band.fbp > 0;
      }),
    };
  }

  function normalizeSnapshot(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      sourceUrl: toText(value.sourceUrl) || DEFAULT_SOURCE_URL,
      source: toText(value.source) || 'official-docs',
      fetchedAt: value.source === 'local-fallback' ? '' : (toText(value.fetchedAt) || new Date().toISOString()),
      rules: (Array.isArray(value.rules) ? value.rules : []).map(normalizeRule).filter(function (rule) {
        return rule.category && rule.bands.length;
      }),
      diagnostics: value.diagnostics && typeof value.diagnostics === 'object' ? value.diagnostics : {},
    };
  }

  function buildSnapshotFromHtml(html, sourceUrl) {
    var section = selectCommissionHtml(html);
    var rules = [];
    var rows = parseTableRows(section);
    if (!rows.length) rows = parseMarkdownTableRows(section);
    rows.forEach(function (cells) {
      var firstPercentIndex = cells.findIndex(function (cell) {
        return /%|％/.test(cell);
      });
      if (firstPercentIndex <= 0) return;
      var prefixCells = cells.slice(0, firstPercentIndex).filter(Boolean);
      var percentValues = cells.slice(firstPercentIndex).map(parsePercent).filter(function (rate) {
        return rate > 0;
      });
      var bands = inferBands(percentValues);
      if (!prefixCells.length || !bands.length) return;
      var category = prefixCells[prefixCells.length - 1];
      var group = prefixCells.length > 1 ? prefixCells[0] : '';
      rules.push({
        group: group,
        category: category,
        aliases: buildAliases(category, group),
        bands: bands,
      });
    });
    return normalizeSnapshot({
      sourceUrl: sourceUrl || DEFAULT_SOURCE_URL,
      source: 'official-docs',
      rules: rules,
      diagnostics: {
        parsedRuleCount: rules.length,
      },
    });
  }

  function bandContainsPrice(band, priceRUB) {
    var price = Math.max(0, toNumber(priceRUB, 0));
    var min = Math.max(0, toNumber(band && band.minRUB, 0));
    var max = Math.max(0, toNumber(band && band.maxRUB, 0));
    return price > min && (max <= 0 || price <= max);
  }

  function scoreRule(rule, hints, categoryIds) {
    var normalizedHints = uniqueStrings(hints).map(normalizeKey).filter(Boolean);
    var normalizedCategoryIds = uniqueIds(categoryIds).map(normalizeKey).filter(Boolean);
    if (!normalizedHints.length && !normalizedCategoryIds.length) return 0;
    var candidates = uniqueStrings([rule.category, rule.typeSpecific ? '' : rule.group].concat(rule.aliases || [])).map(normalizeKey).filter(Boolean);
    var ruleCategoryIds = uniqueIds(rule.categoryIds).map(normalizeKey).filter(Boolean);
    var score = 0;
    ruleCategoryIds.forEach(function (candidate) {
      normalizedCategoryIds.forEach(function (hint) {
        if (candidate && hint && candidate === hint) score = Math.max(score, 150);
      });
    });
    candidates.forEach(function (candidate) {
      normalizedHints.forEach(function (hint) {
        if (!candidate || !hint) return;
        if (candidate === hint) score = Math.max(score, 100);
        else if (!rule.typeSpecific && (hint.indexOf(candidate) >= 0 || candidate.indexOf(hint) >= 0)) score = Math.max(score, Math.min(candidate.length, hint.length));
      });
    });
    return score;
  }

  function manualMatch(manualRatePct) {
    return {
      ratePct: Math.max(0, toNumber(manualRatePct, 0)),
      source: 'manual',
      category: '',
      scheme: '',
      priceBand: { minRUB: 0, maxRUB: 0 },
    };
  }

  function snapshotStatus(snapshot, syncState) {
    var source = toText(snapshot && snapshot.source);
    var count = snapshot && Array.isArray(snapshot.rules) ? snapshot.rules.length : 0;
    var state = !count ? 'unavailable' : source === 'local-fallback' ? 'fallback'
      : source === 'system-category-db' ? 'maintained' : source === 'official-docs' ? 'official' : 'unavailable';
    if (state === 'official' && syncState && syncState.status === 'failed') state = 'cached';
    return { state: state, ruleCount: count, fetchedAt: state === 'fallback' ? '' : toText(snapshot && snapshot.fetchedAt),
      ready: state === 'official' || state === 'maintained' };
  }

  function maxOfficialBandMatch(snapshot, scheme, priceRUB) {
    if (!(priceRUB > 0)) return null;
    var best = null;
    (snapshot.rules || []).forEach(function (rule) {
      (rule.bands || []).forEach(function (band) {
        if (!bandContainsPrice(band, priceRUB)) return;
        var rate = toNumber(band && band[scheme], 0);
        if (!(rate > 0)) return;
        if (!best || rate > best.ratePct) {
          best = {
            ratePct: rate,
            source: snapshot.source === 'local-fallback' ? 'local-fallback' : 'official',
            category: '未知类目最高档参考',
            categoryGroup: '',
            scheme: scheme,
            priceBand: { minRUB: band.minRUB, maxRUB: band.maxRUB },
            snapshotSource: snapshot.sourceUrl,
            fetchedAt: snapshot.fetchedAt,
          };
        }
      });
    });
    return best;
  }

  function matchCommissionRate(snapshot, options) {
    var normalized = normalizeSnapshot(snapshot);
    var input = options && typeof options === 'object' ? options : {};
    var scheme = toText(input.scheme || 'rfbs').toLowerCase() === 'fbp' ? 'fbp' : 'rfbs';
    var hints = Array.isArray(input.categoryHints) ? input.categoryHints : [];
    var categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds : [];
    var priceRUB = toNumber(input.priceRUB, 0);
    var brand = normalizeKey(input.brand);
    var rankedRules = normalized.rules.map(function (rule) {
      return { rule: rule, score: scoreRule(rule, hints, categoryIds) };
    }).filter(function (item) {
      return item.score > 0;
    }).sort(function (left, right) {
      return right.score - left.score;
    });
    var bestScore = rankedRules.length ? rankedRules[0].score : 0;
    if (!brand && rankedRules.some(function (item) { return item.rule.brand && item.score >= bestScore; })) {
      return Object.assign(manualMatch(input.manualRatePct), { reason: 'brand_required' });
    }
    rankedRules = rankedRules.filter(function (item) { return !item.rule.brand || normalizeKey(item.rule.brand) === brand; });
    rankedRules.sort(function (left, right) { return right.score - left.score || Number(Boolean(right.rule.brand)) - Number(Boolean(left.rule.brand)); });
    if (rankedRules.length && rankedRules[0].rule.typeSpecific) {
      var top = rankedRules[0];
      var rates = rankedRules.filter(function (item) {
        return item.score === top.score && Boolean(item.rule.brand) === Boolean(top.rule.brand);
      }).map(function (item) {
        var band = item.rule.bands.find(function (value) { return bandContainsPrice(value, priceRUB); });
        return band ? band[scheme] : null;
      });
      if (rates.some(function (rate) { return rate == null || rate !== rates[0]; })) {
        return Object.assign(manualMatch(input.manualRatePct), { reason: 'ambiguous_category' });
      }
    }

    for (var index = 0; index < rankedRules.length; index += 1) {
      var rule = rankedRules[index].rule;
      var band = rule.bands.find(function (item) {
        return bandContainsPrice(item, priceRUB);
      }) || rule.bands[0];
      var rate = toNumber(band && band[scheme], 0);
      if (rate > 0) {
        return {
          ratePct: rate,
          source: normalized.source === 'local-fallback' ? 'local-fallback' : 'official',
          category: rule.category,
          categoryGroup: rule.group,
          scheme: scheme,
          priceBand: { minRUB: band.minRUB, maxRUB: band.maxRUB },
          snapshotSource: normalized.sourceUrl,
          fetchedAt: normalized.fetchedAt,
        };
      }
    }
    if (normalized.rules.some(function (rule) { return rule.typeSpecific; })) {
      return Object.assign(manualMatch(input.manualRatePct), { reason: 'type_required' });
    }
    var maxBandMatch = maxOfficialBandMatch(normalized, scheme, priceRUB);
    if (maxBandMatch) return maxBandMatch;
    return manualMatch(input.manualRatePct);
  }

  root.OZON_CALC_COMMISSION_RATES = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_SOURCE_URL: DEFAULT_SOURCE_URL,
    normalizeSnapshot: normalizeSnapshot,
    snapshotStatus: snapshotStatus,
    buildSnapshotFromHtml: buildSnapshotFromHtml,
    matchCommissionRate: matchCommissionRate,
  };
}(typeof window !== 'undefined' ? window : globalThis));
