-- 左右耳支持：为自测记录与听力档案增加耳别维度
-- 存量数据（均为开发期测试数据）统一回填为 RIGHT，随后移除临时默认值

-- 1. 耳别枚举
CREATE TYPE "Ear" AS ENUM ('LEFT', 'RIGHT');

-- 2. 自测记录：一次会话只测一只耳
ALTER TABLE "hearing_tests" ADD COLUMN "ear" "Ear" NOT NULL DEFAULT 'RIGHT';
ALTER TABLE "hearing_tests" ALTER COLUMN "ear" DROP DEFAULT;

-- 3. 听力档案：由「每用户一份」改为「每用户每耳一份」
ALTER TABLE "hearing_profiles" ADD COLUMN "ear" "Ear" NOT NULL DEFAULT 'RIGHT';
ALTER TABLE "hearing_profiles" ALTER COLUMN "ear" DROP DEFAULT;

-- 4. 唯一约束：user_id -> (user_id, ear)
DROP INDEX "hearing_profiles_user_id_key";
CREATE UNIQUE INDEX "hearing_profiles_user_id_ear_key" ON "hearing_profiles"("user_id", "ear");

-- 5. 查询索引
CREATE INDEX "hearing_tests_user_id_ear_idx" ON "hearing_tests"("user_id", "ear");
