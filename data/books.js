window.WL = window.WL || {};
(function (WL) {
  'use strict';

  // 紧凑格式： [单词, 音标, 词性, 释义, 例句, 例句译文]
  // 释义里若混入第二词性（如「益处 v. 有益于」），装载时拆成 pos 与释义两段
  var POS_RE = /^(.*?)\s+(n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|phr)\.\s*(.+)$/;

  function normalize(r) {
    var pos = r[2] || '';
    var tr = r[3] || '';
    var m = tr.match(POS_RE);
    if (m && m[1] && m[3]) {
      tr = m[1] + '；' + m[3];
      var head = pos.replace(/\.$/, '');
      var tail = m[2];
      if (head && head.indexOf('/') < 0 && head !== tail) {
        pos = head + './' + tail + '.';
      } else if (head && head.indexOf('/') >= 0 && head.indexOf(tail) < 0) {
        pos = head + '/' + tail + '.';
      }
    }
    return { pos: pos, tr: tr };
  }

  function B(id, name, note, rows) {
    return {
      id: id,
      name: name,
      note: note,
      words: rows.map(function (r, i) {
        var n = normalize(r);
        return {
          id: id + '-' + i,
          w: r[0], ph: r[1], pos: n.pos, tr: n.tr,
          ex: r[4] || '', exCn: r[5] || ''
        };
      })
    };
  }

  var GK = [
    ['abandon', '/əˈbændən/', 'v.', '放弃；抛弃', 'She abandoned the project halfway.', '她中途放弃了这个项目。'],
    ['absorb', '/əbˈzɔːb/', 'v.', '吸收；理解', 'Plants absorb water through their roots.', '植物通过根部吸收水分。'],
    ['abstract', '/ˈæbstrækt/', 'adj.', '抽象的', 'The idea is too abstract for beginners.', '这个想法对初学者来说太抽象。'],
    ['abundant', '/əˈbʌndənt/', 'adj.', '丰富的；充裕的', 'The region has abundant rainfall.', '这个地区雨量充沛。'],
    ['accelerate', '/əkˈseləreɪt/', 'v.', '加速；促进', 'The car accelerated to overtake the truck.', '汽车加速超过了卡车。'],
    ['access', '/ˈækses/', 'n.', '通道；使用权', 'Students have free access to the library.', '学生可以免费使用图书馆。'],
    ['accommodate', '/əˈkɒmədeɪt/', 'v.', '容纳；适应', 'The hall can accommodate five hundred people.', '这个大厅能容纳五百人。'],
    ['accompany', '/əˈkʌmpəni/', 'v.', '陪伴；伴随', 'She accompanied her mother to the hospital.', '她陪母亲去了医院。'],
    ['accomplish', '/əˈkʌmplɪʃ/', 'v.', '完成；实现', 'We accomplished the task ahead of time.', '我们提前完成了任务。'],
    ['accurate', '/ˈækjərət/', 'adj.', '准确的；精确的', 'The report gives an accurate description.', '这份报告描述得很准确。'],
    ['acknowledge', '/əkˈnɒlɪdʒ/', 'v.', '承认；致谢', 'He acknowledged his mistake at once.', '他立刻承认了错误。'],
    ['acquire', '/əˈkwaɪə/', 'v.', '获得；习得', 'Children acquire language surprisingly fast.', '儿童习得语言快得惊人。'],
    ['adapt', '/əˈdæpt/', 'v.', '适应；改编', 'It took him a month to adapt to the climate.', '他花了一个月适应气候。'],
    ['adequate', '/ˈædɪkwət/', 'adj.', '足够的；适当的', 'The room has adequate light for reading.', '房间有足够的阅读光线。'],
    ['adjust', '/əˈdʒʌst/', 'v.', '调整；适应', 'You can adjust the height of the seat.', '你可以调整座椅高度。'],
    ['adopt', '/əˈdɒpt/', 'v.', '采用；收养', 'The school adopted a new teaching method.', '学校采用了新的教学方法。'],
    ['advocate', '/ˈædvəkeɪt/', 'v.', '提倡；主张', 'Many experts advocate a balanced diet.', '许多专家提倡均衡饮食。'],
    ['affect', '/əˈfekt/', 'v.', '影响；感动', 'Noise seriously affects concentration.', '噪音严重影响注意力。'],
    ['afford', '/əˈfɔːd/', 'v.', '负担得起', 'We cannot afford such an expensive car.', '我们买不起这么贵的车。'],
    ['aggressive', '/əˈɡresɪv/', 'adj.', '好斗的；积极进取的', 'He is aggressive in pursuing his goals.', '他追求目标时很有冲劲。'],
    ['alternative', '/ɔːlˈtɜːnətɪv/', 'n.', '替代方案', 'We had no alternative but to wait.', '我们别无选择，只能等。'],
    ['ambitious', '/æmˈbɪʃəs/', 'adj.', '有雄心的', 'She is ambitious and works hard.', '她雄心勃勃而且很努力。'],
    ['anticipate', '/ænˈtɪsɪpeɪt/', 'v.', '预料；期望', 'We anticipate a rise in prices.', '我们预计价格会上涨。'],
    ['apparent', '/əˈpærənt/', 'adj.', '明显的；表面上的', 'It soon became apparent that he was lying.', '很快就明显看出他在撒谎。'],
    ['appreciate', '/əˈpriːʃieɪt/', 'v.', '欣赏；感激', 'I really appreciate your help.', '我非常感激你的帮助。'],
    ['approach', '/əˈprəʊtʃ/', 'n.', '方法；接近', 'This approach works better than the old one.', '这个方法比旧的好用。'],
    ['appropriate', '/əˈprəʊpriət/', 'adj.', '恰当的；合适的', 'Wear appropriate clothes for the interview.', '面试时穿合适的衣服。'],
    ['arbitrary', '/ˈɑːbɪtrəri/', 'adj.', '任意的；武断的', 'The decision seemed completely arbitrary.', '这个决定显得完全武断。'],
    ['arise', '/əˈraɪz/', 'v.', '出现；产生', 'Problems arise when rules are unclear.', '规则不清时问题就出现了。'],
    ['artificial', '/ˌɑːtɪˈfɪʃl/', 'adj.', '人造的；人工的', 'Artificial light cannot replace sunlight.', '人造光无法替代阳光。'],
    ['assess', '/əˈses/', 'v.', '评估；评定', 'Teachers assess students in many ways.', '老师用多种方式评估学生。'],
    ['assign', '/əˈsaɪn/', 'v.', '分配；指派', 'The teacher assigned us a research task.', '老师给我们布置了一个研究任务。'],
    ['assume', '/əˈsjuːm/', 'v.', '假定；承担', 'Do not assume that everyone agrees with you.', '别假定所有人都同意你。'],
    ['attach', '/əˈtætʃ/', 'v.', '附上；重视', 'He attached a photo to the email.', '他在邮件里附了一张照片。'],
    ['attitude', '/ˈætɪtjuːd/', 'n.', '态度', 'Her attitude towards study has changed.', '她对学习的态度变了。'],
    ['authority', '/ɔːˈθɒrəti/', 'n.', '权威；当局', 'The local authority approved the plan.', '地方当局批准了该计划。'],
    ['available', '/əˈveɪləbl/', 'adj.', '可获得的；有空的', 'Tickets are available at the door.', '门口有票出售。'],
    ['aware', '/əˈweə/', 'adj.', '意识到的', 'She was not aware of the danger.', '她没有意识到危险。'],
    ['barrier', '/ˈbæriə/', 'n.', '障碍；屏障', 'Language is the biggest barrier for him.', '语言是他最大的障碍。'],
    ['behave', '/bɪˈheɪv/', 'v.', '表现；举止', 'He behaved as if nothing had happened.', '他表现得好像什么都没发生。'],
    ['benefit', '/ˈbenɪfɪt/', 'n.', '益处 v. 有益于', 'Reading benefits both mind and language.', '阅读对心智和语言都有益。'],
    ['blame', '/bleɪm/', 'v.', '责备；归咎于', 'Do not blame others for your own mistakes.', '别把自己的错误归咎于别人。'],
    ['boost', '/buːst/', 'v.', '促进；提升', 'The news boosted everyone\'s confidence.', '这个消息提升了大家的信心。'],
    ['burden', '/ˈbɜːdn/', 'n.', '负担', 'Heavy homework is a burden for many students.', '繁重的作业对许多学生是负担。'],
    ['campaign', '/kæmˈpeɪn/', 'n.', '运动；活动', 'They launched a campaign against food waste.', '他们发起了一场反对食物浪费的运动。'],
    ['capable', '/ˈkeɪpəbl/', 'adj.', '有能力的', 'She is capable of solving the problem alone.', '她有能力独自解决这个问题。'],
    ['capture', '/ˈkæptʃə/', 'v.', '捕获；捕捉', 'The photo captures a rare moment.', '这张照片捕捉到一个罕见的瞬间。'],
    ['cautious', '/ˈkɔːʃəs/', 'adj.', '谨慎的', 'Be cautious when crossing the street.', '过马路时要小心。'],
    ['challenge', '/ˈtʃælɪndʒ/', 'n.', '挑战 v. 质疑', 'The exam is a real challenge for us.', '这次考试对我们是个真正的挑战。'],
    ['characteristic', '/ˌkærəktəˈrɪstɪk/', 'n./adj.', '特征；典型的', 'Curiosity is a characteristic of good learners.', '好奇心是好学习者的特征。'],
    ['circumstance', '/ˈsɜːkəmstəns/', 'n.', '情况；环境', 'Under no circumstances should you give up.', '在任何情况下你都不该放弃。'],
    ['claim', '/kleɪm/', 'v.', '声称；索取', 'He claims that he saw the accident.', '他声称自己看到了那起事故。'],
    ['classify', '/ˈklæsɪfaɪ/', 'v.', '分类；归类', 'Scientists classify plants by family.', '科学家按科给植物分类。'],
    ['combine', '/kəmˈbaɪn/', 'v.', '结合；联合', 'She combines work with study.', '她把工作和学习结合起来。'],
    ['commit', '/kəˈmɪt/', 'v.', '承诺；犯（错）', 'He committed himself to finishing the book.', '他决心写完这本书。'],
    ['compete', '/kəmˈpiːt/', 'v.', '竞争；比赛', 'Ten teams competed for the prize.', '十支队伍角逐这个奖项。'],
    ['complex', '/ˈkɒmpleks/', 'adj.', '复杂的', 'The problem is more complex than it looks.', '这个问题比看上去更复杂。'],
    ['concentrate', '/ˈkɒnsntreɪt/', 'v.', '集中；专注', 'It is hard to concentrate in a noisy room.', '在吵闹的房间里很难专注。'],
    ['concept', '/ˈkɒnsept/', 'n.', '概念；观念', 'The concept of time varies across cultures.', '时间的概念在不同文化中有所不同。'],
    ['conclude', '/kənˈkluːd/', 'v.', '得出结论；结束', 'The study concluded that sleep matters most.', '研究得出结论：睡眠最重要。'],
    ['conduct', '/kənˈdʌkt/', 'v.', '进行；实施', 'They conducted a survey among students.', '他们在学生中进行了一项调查。'],
    ['confirm', '/kənˈfɜːm/', 'v.', '证实；确认', 'Please confirm your booking by email.', '请通过邮件确认你的预订。'],
    ['conflict', '/ˈkɒnflɪkt/', 'n.', '冲突；矛盾', 'The two plans are in conflict.', '这两个方案互相冲突。'],
    ['consequence', '/ˈkɒnsɪkwəns/', 'n.', '后果；结果', 'He had to face the consequences of his choice.', '他不得不面对自己选择的后果。'],
    ['consistent', '/kənˈsɪstənt/', 'adj.', '一致的；始终如一的', 'Her progress has been consistent all term.', '她整个学期的进步很稳定。'],
    ['constant', '/ˈkɒnstənt/', 'adj.', '不断的；恒定的', 'The constant noise made him nervous.', '不断的噪音让他烦躁。'],
    ['construct', '/kənˈstrʌkt/', 'v.', '建造；构建', 'They constructed a model of the solar system.', '他们做了一个太阳系模型。'],
    ['consume', '/kənˈsjuːm/', 'v.', '消耗；消费', 'This machine consumes little electricity.', '这台机器耗电很少。'],
    ['contemporary', '/kənˈtemprəri/', 'adj.', '当代的；同时代的', 'She studies contemporary Chinese literature.', '她研究中国当代文学。'],
    ['context', '/ˈkɒntekst/', 'n.', '语境；背景', 'Guess the meaning from the context.', '从语境中猜出词义。'],
    ['contribute', '/kənˈtrɪbjuːt/', 'v.', '贡献；促成', 'Everyone contributed ideas to the project.', '每个人都为这个项目出了主意。'],
    ['convenient', '/kənˈviːniənt/', 'adj.', '方便的', 'Come whenever it is convenient for you.', '你方便的时候随时来。'],
    ['convince', '/kənˈvɪns/', 'v.', '说服；使信服', 'He convinced me to join the club.', '他说服我加入了社团。'],
    ['crucial', '/ˈkruːʃl/', 'adj.', '至关重要的', 'Sleep is crucial for memory.', '睡眠对记忆至关重要。'],
    ['cultivate', '/ˈkʌltɪveɪt/', 'v.', '培养；耕作', 'Reading cultivates the habit of thinking.', '阅读培养思考的习惯。'],
    ['decline', '/dɪˈklaɪn/', 'v.', '下降；婉拒', 'The number of readers has declined.', '读者数量下降了。'],
    ['dedicate', '/ˈdedɪkeɪt/', 'v.', '奉献；致力于', 'She dedicated her life to teaching.', '她把一生献给了教学。'],
    ['define', '/dɪˈfaɪn/', 'v.', '定义；界定', 'How do you define success?', '你如何定义成功？'],
    ['delicate', '/ˈdelɪkət/', 'adj.', '精致的；微妙的', 'It is a delicate balance to keep.', '这是一种需要小心维持的平衡。'],
    ['demonstrate', '/ˈdemənstreɪt/', 'v.', '证明；演示', 'The experiment demonstrates the principle.', '这个实验证明了这一原理。'],
    ['deny', '/dɪˈnaɪ/', 'v.', '否认；拒绝给予', 'He denied breaking the window.', '他否认打破了窗户。'],
    ['derive', '/dɪˈraɪv/', 'v.', '源自；获得', 'The word derives from Latin.', '这个词源自拉丁语。'],
    ['deserve', '/dɪˈzɜːv/', 'v.', '值得；应得', 'You deserve a rest after all that work.', '干了这么多活，你该休息一下。'],
    ['despite', '/dɪˈspaɪt/', 'prep.', '尽管', 'Despite the rain, they kept walking.', '尽管下雨，他们还是继续走。'],
    ['determine', '/dɪˈtɜːmɪn/', 'v.', '决定；确定', 'Attitude determines how far you go.', '态度决定你能走多远。'],
    ['devote', '/dɪˈvəʊt/', 'v.', '致力于；献身', 'He devoted himself to the research.', '他全身心投入这项研究。'],
    ['distinguish', '/dɪˈstɪŋɡwɪʃ/', 'v.', '区分；辨别', 'Can you distinguish the two sounds?', '你能分辨这两个音吗？'],
    ['distribute', '/dɪˈstrɪbjuːt/', 'v.', '分发；分布', 'Volunteers distributed food to the victims.', '志愿者向灾民分发食物。'],
    ['diverse', '/daɪˈvɜːs/', 'adj.', '多样的；不同的', 'The city has a diverse population.', '这座城市人口多元。'],
    ['domestic', '/dəˈmestɪk/', 'adj.', '国内的；家庭的', 'Domestic travel grew rapidly this year.', '今年国内旅游增长迅速。'],
    ['dominant', '/ˈdɒmɪnənt/', 'adj.', '占主导地位的', 'English is dominant in this field.', '英语在这个领域占主导地位。'],
    ['dynamic', '/daɪˈnæmɪk/', 'adj.', '有活力的；动态的', 'She has a dynamic personality.', '她个性很有活力。'],
    ['efficient', '/ɪˈfɪʃnt/', 'adj.', '高效的', 'This is a far more efficient method.', '这是个高效得多的方法。'],
    ['eliminate', '/ɪˈlɪmɪneɪt/', 'v.', '消除；淘汰', 'We must eliminate the source of the noise.', '我们必须消除噪音源。'],
    ['emerge', '/iˈmɜːdʒ/', 'v.', '出现；显露', 'New problems emerged during the test.', '测试过程中出现了新问题。'],
    ['emphasize', '/ˈemfəsaɪz/', 'v.', '强调', 'The teacher emphasized the importance of reading.', '老师强调了阅读的重要性。'],
    ['enhance', '/ɪnˈhɑːns/', 'v.', '提高；增强', 'Practice enhances fluency.', '练习能提高流利度。'],
    ['ensure', '/ɪnˈʃʊə/', 'v.', '确保；保证', 'Please ensure the door is locked.', '请确保门已锁好。'],
    ['essential', '/ɪˈsenʃl/', 'adj.', '必不可少的', 'Water is essential to life.', '水对生命必不可少。'],
    ['establish', '/ɪˈstæblɪʃ/', 'v.', '建立；确立', 'The club was established in 2005.', '这个社团成立于2005年。'],
    ['evaluate', '/ɪˈvæljueɪt/', 'v.', '评价；评估', 'We need to evaluate the results carefully.', '我们需要仔细评估结果。'],
    ['evidence', '/ˈevɪdəns/', 'n.', '证据', 'There is no evidence for that claim.', '那个说法没有证据。'],
    ['exhibit', '/ɪɡˈzɪbɪt/', 'v.', '展出；表现', 'The museum exhibits ancient coins.', '博物馆展出古代钱币。'],
    ['expand', '/ɪkˈspænd/', 'v.', '扩大；膨胀', 'The company plans to expand overseas.', '公司计划向海外扩张。'],
    ['expose', '/ɪkˈspəʊz/', 'v.', '暴露；揭露', 'Do not expose the film to light.', '别让胶片曝光。'],
    ['facilitate', '/fəˈsɪlɪteɪt/', 'v.', '促进；使便利', 'Good notes facilitate review.', '好的笔记方便复习。'],
    ['fundamental', '/ˌfʌndəˈmentl/', 'adj.', '基本的；根本的', 'Reading is a fundamental skill.', '阅读是一项基本技能。'],
    ['generate', '/ˈdʒenəreɪt/', 'v.', '产生；生成', 'The plan generated a lot of discussion.', '这个方案引发了大量讨论。'],
    ['genuine', '/ˈdʒenjuɪn/', 'adj.', '真正的；真诚的', 'She showed genuine interest in the topic.', '她对这个话题表现出真正的兴趣。'],
    ['guarantee', '/ˌɡærənˈtiː/', 'v.', '保证；担保', 'Hard work does not guarantee success.', '努力并不保证成功。'],
    ['identify', '/aɪˈdentɪfaɪ/', 'v.', '识别；确认', 'Can you identify the problem in this sentence?', '你能找出这句话的问题吗？'],
    ['impact', '/ˈɪmpækt/', 'n.', '影响；冲击', 'The policy had a great impact on schools.', '这项政策对学校影响很大。'],
    ['implement', '/ˈɪmplɪment/', 'v.', '实施；执行', 'The school implemented the new rule in May.', '学校五月开始实施新规定。'],
    ['incorporate', '/ɪnˈkɔːpəreɪt/', 'v.', '包含；并入', 'The design incorporates local elements.', '这个设计融入了本地元素。'],
    ['indicate', '/ˈɪndɪkeɪt/', 'v.', '表明；指出', 'The data indicate a clear trend.', '数据表明了一个清晰的趋势。'],
    ['inevitable', '/ɪnˈevɪtəbl/', 'adj.', '不可避免的', 'Mistakes are inevitable when learning.', '学习过程中犯错不可避免。'],
    ['initial', '/ɪˈnɪʃl/', 'adj.', '最初的；开始的', 'The initial results look promising.', '初步结果看起来不错。'],
    ['innovative', '/ˈɪnəveɪtɪv/', 'adj.', '创新的', 'They came up with an innovative solution.', '他们想出了一个创新的解决方案。'],
    ['insight', '/ˈɪnsaɪt/', 'n.', '洞察力；见解', 'The book offers real insight into memory.', '这本书对记忆有真正的洞见。'],
    ['intense', '/ɪnˈtens/', 'adj.', '强烈的；紧张的', 'The competition was intense.', '竞争非常激烈。'],
    ['interpret', '/ɪnˈtɜːprɪt/', 'v.', '解释；口译', 'How do you interpret this line?', '你如何理解这一行？'],
    ['investigate', '/ɪnˈvestɪɡeɪt/', 'v.', '调查；研究', 'They investigated the cause of the failure.', '他们调查了失败的原因。'],
    ['involve', '/ɪnˈvɒlv/', 'v.', '涉及；使参与', 'The task involves a lot of reading.', '这项任务涉及大量阅读。'],
    ['justify', '/ˈdʒʌstɪfaɪ/', 'v.', '证明正当；为…辩解', 'Nothing can justify cheating.', '没有任何理由能为作弊辩护。'],
    ['maintain', '/meɪnˈteɪn/', 'v.', '维持；坚持认为', 'It is hard to maintain such a pace.', '很难维持这样的节奏。'],
    ['motivation', '/ˌməʊtɪˈveɪʃn/', 'n.', '动机；积极性', 'Clear goals increase motivation.', '明确的目标能提高积极性。'],
    ['negative', '/ˈneɡətɪv/', 'adj.', '负面的；否定的', 'Constant criticism has a negative effect.', '不断的批评有负面作用。'],
    ['observe', '/əbˈzɜːv/', 'v.', '观察；遵守', 'She observed how children learn words.', '她观察儿童如何学词。'],
    ['obtain', '/əbˈteɪn/', 'v.', '获得；得到', 'You can obtain the form online.', '你可以在网上获取表格。'],
    ['occurrence', '/əˈkʌrəns/', 'n.', '发生；事件', 'Such errors are a common occurrence.', '这类错误很常见。'],
    ['participate', '/pɑːˈtɪsɪpeɪt/', 'v.', '参加；参与', 'Everyone participated in the discussion.', '每个人都参与了讨论。'],
    ['perceive', '/pəˈsiːv/', 'v.', '察觉；认为', 'Students perceive the task as difficult.', '学生认为这项任务很难。'],
    ['potential', '/pəˈtenʃl/', 'n./adj.', '潜力；潜在的', 'He has great potential in writing.', '他在写作上很有潜力。'],
    ['precise', '/prɪˈsaɪs/', 'adj.', '精确的；准确的', 'Give me a precise figure, please.', '请给我一个确切的数字。'],
    ['preserve', '/prɪˈzɜːv/', 'v.', '保存；保护', 'We must preserve these old buildings.', '我们必须保护这些老建筑。'],
    ['priority', '/praɪˈɒrəti/', 'n.', '优先事项', 'Study should be your first priority.', '学习应该是你的首要任务。'],
    ['promote', '/prəˈməʊt/', 'v.', '促进；推广', 'The campaign promotes healthy eating.', '这场活动推广健康饮食。'],
    ['pursue', '/pəˈsjuː/', 'v.', '追求；从事', 'She decided to pursue a career in law.', '她决定从事法律行业。'],
    ['reinforce', '/ˌriːɪnˈfɔːs/', 'v.', '加强；巩固', 'Review reinforces what you have learned.', '复习能巩固你所学的内容。'],
    ['reluctant', '/rɪˈlʌktənt/', 'adj.', '不情愿的', 'He was reluctant to admit his mistake.', '他不情愿承认错误。'],
    ['rely', '/rɪˈlaɪ/', 'v.', '依赖；依靠', 'Do not rely on luck in the exam.', '考试别指望运气。'],
    ['remarkable', '/rɪˈmɑːkəbl/', 'adj.', '非凡的；显著的', 'She made remarkable progress this term.', '这学期她进步显著。'],
    ['resilient', '/rɪˈzɪliənt/', 'adj.', '有韧性的；能恢复的', 'Resilient students recover from failure quickly.', '有韧性的学生能迅速从失败中恢复。'],
    ['reveal', '/rɪˈviːl/', 'v.', '揭示；显露', 'The survey revealed an interesting pattern.', '调查揭示了一个有趣的规律。'],
    ['significant', '/sɪɡˈnɪfɪkənt/', 'adj.', '重要的；显著的', 'There is a significant difference between them.', '它们之间有显著差异。'],
    ['strategy', '/ˈstrætədʒi/', 'n.', '策略；战略', 'Spaced repetition is a proven strategy.', '间隔重复是经过验证的策略。'],
    ['sufficient', '/səˈfɪʃnt/', 'adj.', '充足的；足够的', 'Make sure you get sufficient sleep.', '一定要保证充足的睡眠。'],
    ['sustain', '/səˈsteɪn/', 'v.', '维持；支撑', 'It is hard to sustain such effort.', '很难长时间维持这样的努力。'],
    ['transform', '/trænsˈfɔːm/', 'v.', '改变；转化', 'The internet transformed how we learn.', '互联网改变了我们学习的方式。'],
    ['typical', '/ˈtɪpɪkl/', 'adj.', '典型的；一贯的', 'This is a typical mistake for beginners.', '这是初学者的典型错误。'],
    ['urgent', '/ˈɜːdʒənt/', 'adj.', '紧急的', 'The letter was marked urgent.', '这封信被标为急件。'],
    ['vital', '/ˈvaɪtl/', 'adj.', '至关重要的', 'Listening is vital in language learning.', '听力在语言学习中至关重要。']
  ];

  var TEXTBOOK = [
    ['severe', '/sɪˈvɪə/', 'adj.', '严重的；严厉的', 'He suffered from a severe headache.', '他头痛得很厉害。'],
    ['infection', '/ɪnˈfekʃn/', 'n.', '感染；传染', 'The infection spread quickly through the class.', '感染在班里迅速传播。'],
    ['subscribe', '/səbˈskraɪb/', 'v.', '订阅；赞同', 'I subscribe to two science magazines.', '我订阅了两本科学杂志。'],
    ['proof', '/pruːf/', 'n.', '证据；证明', 'There is no proof that the theory is right.', '没有证据表明这个理论是对的。'],
    ['multiply', '/ˈmʌltɪplaɪ/', 'v.', '繁殖；乘；成倍增加', 'Bacteria multiply quickly in warm conditions.', '细菌在温暖环境中迅速繁殖。'],
    ['intervene', '/ˌɪntəˈviːn/', 'v.', '干预；介入', 'The doctor had to intervene immediately.', '医生必须立即介入。'],
    ['suspect', '/səˈspekt/', 'v.', '怀疑 n. 嫌疑人', 'We suspect that the data are wrong.', '我们怀疑数据有误。'],
    ['forecast', '/ˈfɔːkɑːst/', 'n.', '预报 v. 预测', 'The forecast says it will rain tomorrow.', '预报说明天有雨。'],
    ['microscope', '/ˈmaɪkrəskəʊp/', 'n.', '显微镜', 'He looked at the cells under a microscope.', '他在显微镜下观察细胞。'],
    ['household', '/ˈhaʊshəʊld/', 'n.', '家庭；家户', 'Most households now have a computer.', '现在大多数家庭都有电脑。'],
    ['exchange', '/ɪksˈtʃeɪndʒ/', 'n.', '交流；交换', 'The exchange programme changed her life.', '这个交流项目改变了她的人生。'],
    ['adjustment', '/əˈdʒʌstmənt/', 'n.', '调整；适应', 'Culture shock is part of the adjustment.', '文化冲击是适应过程的一部分。'],
    ['homesick', '/ˈhəʊmsɪk/', 'adj.', '想家的', 'She felt homesick in the first month.', '第一个月她很想家。'],
    ['mature', '/məˈtʃʊə/', 'adj.', '成熟的 v. 成熟', 'He became more mature after the year abroad.', '出国一年后他成熟了许多。'],
    ['grasp', '/ɡrɑːsp/', 'v.', '抓住；理解', 'It took a while to grasp the local accent.', '花了一阵子才听懂当地口音。'],
    ['recommend', '/ˌrekəˈmend/', 'v.', '推荐；建议', 'Could you recommend a good dictionary?', '你能推荐一本好词典吗？'],
    ['cuisine', '/kwɪˈziːn/', 'n.', '烹饪；菜系', 'Sichuan cuisine is famous for its heat.', '川菜以辣闻名。'],
    ['ingredient', '/ɪnˈɡriːdiənt/', 'n.', '原料；成分', 'Fresh ingredients make a real difference.', '新鲜食材带来真正的差别。'],
    ['flavour', '/ˈfleɪvə/', 'n.', '味道；风味', 'This soup has a rich flavour.', '这汤味道很浓。'],
    ['digest', '/daɪˈdʒest/', 'v.', '消化；理解', 'Some food is hard to digest at night.', '有些食物晚上很难消化。'],
    ['nutrition', '/njuˈtrɪʃn/', 'n.', '营养', 'Good nutrition supports learning.', '良好的营养有助于学习。'],
    ['roast', '/rəʊst/', 'v.', '烤；烘', 'They roasted a chicken for dinner.', '他们烤了一只鸡当晚餐。'],
    ['steam', '/stiːm/', 'v.', '蒸 n. 蒸汽', 'Steam the fish for eight minutes.', '把鱼蒸八分钟。'],
    ['spicy', '/ˈspaɪsi/', 'adj.', '辛辣的', 'The dish is too spicy for me.', '这道菜对我来说太辣了。'],
    ['vast', '/vɑːst/', 'adj.', '广阔的；巨大的', 'They crossed a vast desert.', '他们穿越了一片广袤的沙漠。'],
    ['scenery', '/ˈsiːnəri/', 'n.', '风景；景色', 'The scenery along the railway is stunning.', '铁路沿线的风景美得惊人。'],
    ['glacier', '/ˈɡlæsiə/', 'n.', '冰川', 'The glacier has shrunk over the years.', '这些年来冰川缩小了。'],
    ['remote', '/rɪˈməʊt/', 'adj.', '偏远的；遥远的', 'They live in a remote mountain village.', '他们住在一个偏远的山村。'],
    ['wilderness', '/ˈwɪldənəs/', 'n.', '荒野；荒漠', 'The train crossed miles of wilderness.', '火车穿越了数英里的荒野。'],
    ['coast', '/kəʊst/', 'n.', '海岸；海滨', 'The town lies on the east coast.', '这个镇位于东海岸。'],
    ['injury', '/ˈɪndʒəri/', 'n.', '伤害；损伤', 'He suffered a knee injury in the match.', '他在比赛中膝盖受伤。'],
    ['bleed', '/bliːd/', 'v.', '流血', 'The cut bled for a few minutes.', '伤口流了几分钟血。'],
    ['bandage', '/ˈbændɪdʒ/', 'n.', '绷带 v. 包扎', 'Wrap a clean bandage around the wound.', '用干净的绷带包住伤口。'],
    ['victim', '/ˈvɪktɪm/', 'n.', '受害者；伤员', 'The victims were taken to hospital at once.', '伤员被立即送往医院。'],
    ['unconscious', '/ʌnˈkɒnʃəs/', 'adj.', '失去知觉的', 'He was unconscious when help arrived.', '救援到达时他已失去知觉。'],
    ['choke', '/tʃəʊk/', 'v.', '窒息；噎住', 'She choked on a piece of bread.', '她被一块面包噎住了。'],
    ['emergency', '/ɪˈmɜːdʒənsi/', 'n.', '紧急情况', 'Call this number in an emergency.', '紧急情况请拨这个号码。'],
    ['rescue', '/ˈreskjuː/', 'v.', '营救 n. 救援', 'They rescued two children from the river.', '他们从河里救出两个孩子。'],
    ['pressure', '/ˈpreʃə/', 'n.', '压力；压强', 'Apply pressure to stop the bleeding.', '按压以止血。']
  ];

  var MINE = [
    ['activate', '/ˈæktɪveɪt/', 'v.', '激活；启动', 'The app activates after you log in.', '登录后应用就会激活。'],
    ['craze', '/kreɪz/', 'n.', '狂热；风尚', 'The craze for short videos spread fast.', '短视频热潮传播得很快。'],
    ['do sb a favour', '/duː ˌsʌmbədi ə ˈfeɪvə/', 'phr.', '帮某人一个忙', 'Could you do me a favour and close the door?', '能帮我个忙把门关上吗？'],
    ['go hand in hand with', '/ɡəʊ hænd ɪn hænd wɪð/', 'phr.', '与…密切相关', 'Progress goes hand in hand with practice.', '进步与练习密切相关。'],
    ['joint', '/dʒɔɪnt/', 'adj.', '共同的 n. 关节', 'They carried out a joint study.', '他们做了一项联合研究。'],
    ['jungle', '/ˈdʒʌŋɡl/', 'n.', '丛林；杂乱的一堆', 'It is a jungle of rules out there.', '外面是一堆杂乱无章的规则。'],
    ['keep to themselves', '/kiːp tə ðəmˈselvz/', 'phr.', '不与人来往', 'They keep to themselves most of the time.', '他们大部分时间不与人来往。'],
    ['merciful', '/ˈmɜːsɪfl/', 'adj.', '仁慈的；宽容的', 'The judge was merciful to the young man.', '法官对这个年轻人很宽容。'],
    ['occurrence', '/əˈkʌrəns/', 'n.', '发生；事件', 'Power cuts are a daily occurrence here.', '这里每天都会停电。'],
    ['prepare oneself for', '/prɪˈpeə wʌnˈself fɔː/', 'phr.', '为…做好准备', 'Prepare yourself for a long wait.', '做好长时间等待的准备。'],
    ['showcase', '/ˈʃəʊkeɪs/', 'v.', '展示 n. 展示柜', 'The fair showcases student projects.', '这个展会展出学生作品。'],
    ['shone through', '/ʃɒn θruː/', 'phr.', '显露出来；表现出色', 'Her kindness shone through in every detail.', '她的善意在每个细节中都显露出来。'],
    ['surge', '/sɜːdʒ/', 'n.', '激增 v. 涌动', 'There was a surge in demand for the book.', '这本书的需求激增。'],
    ['tease', '/tiːz/', 'v.', '取笑；戏弄', 'They teased him about his new haircut.', '他们拿他的新发型开玩笑。'],
    ['unconcerned', '/ˌʌnkənˈsɜːnd/', 'adj.', '漠不关心的', 'He seemed unconcerned about the result.', '他似乎对结果毫不在意。'],
    ['with a dry sense of humour', '/wɪð ə draɪ sens əv ˈhjuːmə/', 'phr.', '带着冷幽默', 'He tells stories with a dry sense of humour.', '他讲故事的风格带着冷幽默。']
  ];

  WL.books = [
    B('gk', '高考核心高频', '按字母序收录的高考高频词，可导入扩充', GK),
    B('tb', '教材 · 选必二', '人教版选择性必修二 Unit 1–5 常见词，可自行校正', TEXTBOOK),
    B('mine', '我的积累', '课外积累与易错词，随时增补', MINE)
  ];
})(window.WL);
